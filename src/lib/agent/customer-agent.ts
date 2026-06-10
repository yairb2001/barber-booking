/**
 * DOMINANT WhatsApp Customer Agent
 * ──────────────────────────────────
 * Handles booking, cancellation, info queries via WhatsApp.
 * Model router: Haiku 4.5 for simple turns, Sonnet 4.6 for booking/cancel/
 * complex reasoning — keeps the common case ~5-10x cheaper.
 *
 * Flow per incoming message:
 *  1. Load/create Conversation + load last N messages
 *  2. Append user message
 *  3. Call Claude with tools
 *  4. Execute tool calls (Prisma, not HTTP)
 *  5. Save assistant reply + send via Green API
 */

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { notifyWaitlistForCancellation } from "@/lib/waitlist-notify";
import { pushToOwner } from "@/lib/native/push";
import {
  generateSlots,
  getDayOfWeek,
  timeToMinutes,
  getBusinessNow,
} from "@/lib/utils";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// ── Model router ────────────────────────────────────────────────────────────
// Cheap model handles greetings + simple info queries; strong model handles
// booking / cancellation / multi-step reasoning. Saves ~5-10x on the common case.
const MODEL_FAST  = "claude-haiku-4-5";
const MODEL_SMART = "claude-sonnet-4-6";
const MAX_HISTORY = 20; // messages loaded from DB per conversation turn

// Hebrew intent signals that justify the strong model from the very first turn.
const SMART_INTENT = /לקבוע|תור|לבטל|ביטול|להזיז|להעביר|לשנות|דחוף|תלונה|טעות|לא עבד|בעיה/;

// Tools whose use means we're mid high-stakes flow → escalate to the strong model.
const SMART_TOOLS = new Set(["get_available_slots", "book_appointment", "cancel_appointment"]);

function pickInitialModel(
  incomingText: string,
  recentToolNames: (string | null)[]
): string {
  if (SMART_INTENT.test(incomingText)) return MODEL_SMART;
  if (recentToolNames.some(t => t && SMART_TOOLS.has(t))) return MODEL_SMART;
  return MODEL_FAST;
}

// ─── Tool definitions ──────────────────────────────────────────────────────────

const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_services",
    description: "מחזיר רשימת השירותים הזמינים עם מחיר ומשך בדקות.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_staff_list",
    description: "מחזיר רשימת הספרים הזמינים (שם, מזהה, זמינות).",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_available_slots",
    description: "מחזיר רשימת שעות פנויות לתאריך נתון. אם לא צוין ספר — מחזיר לכולם.",
    input_schema: {
      type: "object" as const,
      properties: {
        date:      { type: "string", description: "תאריך בפורמט YYYY-MM-DD" },
        staffId:   { type: "string", description: "מזהה ספר (אופציונלי)" },
        serviceId: { type: "string", description: "מזהה שירות (אופציונלי)" },
      },
      required: ["date"],
    },
  },
  {
    name: "book_appointment",
    description: "קובע תור חדש ללקוח. יש לאשר את הפרטים עם הלקוח לפני הקביעה.",
    input_schema: {
      type: "object" as const,
      properties: {
        staffId:       { type: "string", description: "מזהה הספר" },
        serviceId:     { type: "string", description: "מזהה השירות" },
        date:          { type: "string", description: "תאריך YYYY-MM-DD" },
        startTime:     { type: "string", description: "שעת התחלה HH:MM" },
        customerName:  { type: "string", description: "שם הלקוח" },
        customerPhone: { type: "string", description: "טלפון הלקוח (E.164)" },
      },
      required: ["staffId", "serviceId", "date", "startTime", "customerName", "customerPhone"],
    },
  },
  {
    name: "check_appointment",
    description: "בודק אם ללקוח יש תורים קרובים קיימים.",
    input_schema: {
      type: "object" as const,
      properties: {
        customerPhone: { type: "string", description: "טלפון הלקוח" },
      },
      required: ["customerPhone"],
    },
  },
  {
    name: "cancel_appointment",
    description: "מבטל תור קיים לפי מזהה. יש לאשר עם הלקוח לפני הביטול.",
    input_schema: {
      type: "object" as const,
      properties: {
        appointmentId: { type: "string", description: "מזהה התור לביטול" },
      },
      required: ["appointmentId"],
    },
  },
  {
    name: "get_business_info",
    description: "מחזיר מידע על העסק: כתובת, טלפון, שעות פעילות.",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "escalate_to_human",
    description: "מסמן שצריך להעביר לאדם אמיתי — לשימוש כשהלקוח מבקש לדבר עם ספר/בעל עסק, או כשהסוכן לא מצליח לעזור.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: { type: "string", description: "סיבת ההעברה בקצרה" },
      },
      required: ["reason"],
    },
  },
];

// ─── Tool executors ────────────────────────────────────────────────────────────

async function execTool(
  name: string,
  input: Record<string, string>,
  bizId: string,
  conversationId: string
): Promise<string> {
  try {
    switch (name) {
      // ── get_services ────────────────────────────────────────────────────────
      case "get_services": {
        const services = await prisma.service.findMany({
          where: { businessId: bizId, isVisible: true },
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true, price: true, durationMinutes: true, note: true },
        });
        if (!services.length) return "אין שירותים פעילים.";
        return services
          .map(s => `• ${s.name} — ${s.price}₪, ${s.durationMinutes} דקות${s.note ? ` (${s.note})` : ""} [id: ${s.id}]`)
          .join("\n");
      }

      // ── get_staff_list ───────────────────────────────────────────────────────
      case "get_staff_list": {
        const staff = await prisma.staff.findMany({
          where: { businessId: bizId, isAvailable: true },
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true, nickname: true },
        });
        if (!staff.length) return "אין ספרים פעילים כרגע.";
        return staff
          .map(s => `• ${s.name}${s.nickname ? ` (${s.nickname})` : ""} [id: ${s.id}]`)
          .join("\n");
      }

      // ── get_available_slots ──────────────────────────────────────────────────
      case "get_available_slots": {
        const { date, staffId: inputStaffId, serviceId: inputServiceId } = input;
        const dateObj = new Date(date + "T00:00:00.000Z");
        const dayOfWeek = getDayOfWeek(dateObj);
        const nowBiz = getBusinessNow();

        // Determine which staff members to check
        const staffList = await prisma.staff.findMany({
          where: { businessId: bizId, isAvailable: true, ...(inputStaffId ? { id: inputStaffId } : {}) },
          select: { id: true, name: true },
        });

        if (!staffList.length) return "אין ספרים פעילים.";

        const byStaff = new Map<string, string[]>();

        for (const staff of staffList) {
          // Get service duration
          let duration = 30;
          if (inputServiceId) {
            const ss = await prisma.staffService.findUnique({
              where: { staffId_serviceId: { staffId: staff.id, serviceId: inputServiceId } },
              include: { service: true },
            });
            if (!ss) continue; // staff doesn't offer this service
            duration = ss.customDuration ?? ss.service.durationMinutes;
          } else {
            // Default to shortest service
            const firstSvc = await prisma.staffService.findFirst({
              where: { staffId: staff.id },
              include: { service: true },
              orderBy: { service: { durationMinutes: "asc" } },
            });
            duration = firstSvc?.customDuration ?? firstSvc?.service.durationMinutes ?? 30;
          }

          // Check override
          const override = await prisma.staffScheduleOverride.findUnique({
            where: { staffId_date: { staffId: staff.id, date: dateObj } },
          });
          if (override && !override.isWorking) continue; // day off

          let scheduleSlots: { start: string; end: string }[] = [];
          let breaks: { start: string; end: string }[] | null = null;

          if (override?.isWorking && override.slots) {
            scheduleSlots = JSON.parse(override.slots);
            breaks = override.breaks ? JSON.parse(override.breaks) : null;
          } else {
            const schedule = await prisma.staffSchedule.findUnique({
              where: { staffId_dayOfWeek: { staffId: staff.id, dayOfWeek } },
            });
            if (!schedule?.isWorking) continue;
            scheduleSlots = JSON.parse(schedule.slots);
            breaks = schedule.breaks ? JSON.parse(schedule.breaks) : null;
          }

          // Existing appointments
          const booked = await prisma.appointment.findMany({
            where: { staffId: staff.id, date: dateObj, status: { in: ["pending", "confirmed"] } },
            select: { startTime: true, endTime: true },
          });

          let slots = generateSlots(scheduleSlots, breaks, duration, booked);

          // Filter past slots if today
          if (nowBiz.date === date) {
            slots = slots.filter(s => timeToMinutes(s) >= nowBiz.minutes + 15);
          }

          if (slots.length) byStaff.set(staff.name, slots);
        }

        if (!byStaff.size) return `אין תורים פנויים בתאריך ${date}.`;
        return Array.from(byStaff.entries())
          .map(([name, times]) => `${name}: ${times.join(", ")}`)
          .join("\n");
      }

      // ── book_appointment ─────────────────────────────────────────────────────
      case "book_appointment": {
        const { staffId, serviceId, date, startTime, customerName, customerPhone } = input;
        const phone = normalizeIsraeliPhone(customerPhone);

        const [staff, service, biz] = await Promise.all([
          prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, name: true } }),
          prisma.service.findUnique({ where: { id: serviceId }, select: { id: true, name: true, price: true, durationMinutes: true } }),
          prisma.business.findUnique({ where: { id: bizId }, select: { id: true, name: true } }),
        ]);
        if (!staff || !service || !biz) return "שגיאה: ספר, שירות, או עסק לא נמצאו.";

        // Upsert customer
        let customer = await prisma.customer.findUnique({ where: { businessId_phone: { businessId: bizId, phone } } });
        if (!customer) {
          customer = await prisma.customer.create({
            data: { businessId: bizId, phone, name: customerName, referralSource: "whatsapp" },
          });
        } else if (customer.name !== customerName) {
          customer = await prisma.customer.update({ where: { id: customer.id }, data: { name: customerName } });
        }

        // Link customer to conversation
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { customerId: customer.id },
        });

        // Calculate times
        const apptDate = new Date(`${date}T${startTime}:00.000Z`);
        const endDate  = new Date(apptDate.getTime() + service.durationMinutes * 60_000);
        const endTime  = endDate.toISOString().slice(11, 16);

        // Create appointment
        const appt = await prisma.appointment.create({
          data: {
            businessId: bizId,
            customerId: customer.id,
            staffId,
            serviceId,
            date:      apptDate,
            startTime,
            endTime,
            status:    "confirmed",
            price:     service.price,
            referralSource: "whatsapp_agent",
          },
        });

        return `✅ תור נקבע בהצלחה!\n📅 ${date} ב-${startTime}\n💈 ${service.name} אצל ${staff.name}\n💰 ${service.price}₪\nמזהה תור: ${appt.id}`;
      }

      // ── check_appointment ────────────────────────────────────────────────────
      case "check_appointment": {
        const phone = normalizeIsraeliPhone(input.customerPhone || "");
        const customer = await prisma.customer.findUnique({
          where: { businessId_phone: { businessId: bizId, phone } },
        });
        if (!customer) return "לא נמצא לקוח עם מספר זה במערכת.";

        const now = new Date();
        const appointments = await prisma.appointment.findMany({
          where: {
            customerId: customer.id,
            businessId: bizId,
            date: { gte: now },
            status: { in: ["confirmed", "pending"] },
          },
          include: { staff: true, service: true },
          orderBy: { date: "asc" },
          take: 3,
        });

        if (!appointments.length) return "לא נמצאו תורים קרובים ללקוח זה.";
        return appointments
          .map(a => {
            const d = new Date(a.date);
            const dateStr = d.toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
            return `• ${dateStr} ${a.startTime} — ${a.service.name} אצל ${a.staff.name} [id: ${a.id}]`;
          })
          .join("\n");
      }

      // ── cancel_appointment ───────────────────────────────────────────────────
      case "cancel_appointment": {
        const appt = await prisma.appointment.findUnique({
          where: { id: input.appointmentId },
          include: { staff: true, service: true, customer: { select: { name: true } } },
        });
        if (!appt || appt.businessId !== bizId) return "תור לא נמצא.";
        if (["cancelled_by_customer", "cancelled_by_staff"].includes(appt.status)) return "תור זה כבר בוטל.";

        await prisma.appointment.update({
          where: { id: appt.id },
          data: { status: "cancelled_by_customer", cancelledAt: new Date() },
        });

        // Notify the business owner/manager (native app) — a customer self-cancelled
        {
          const ownerDateStr = new Date(appt.date).toLocaleDateString("he-IL", {
            weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem",
          });
          pushToOwner(appt.businessId, {
            title: "תור בוטל ע״י הלקוח ❌",
            body: `${appt.customer.name} אצל ${appt.staff.name}\n${ownerDateStr} בשעה ${appt.startTime}`,
            data: { type: "appointment_cancelled", appointmentId: appt.id },
          }).catch(() => {});
        }

        // Notify waitlist members — a slot just freed up
        notifyWaitlistForCancellation({
          businessId: appt.businessId,
          staffId:    appt.staffId,
          date:       appt.date,
          startTime:  appt.startTime,
        }).catch(console.error);

        const dateStr = new Date(appt.date).toLocaleDateString("he-IL", {
          weekday: "short", day: "numeric", month: "long", timeZone: "Asia/Jerusalem",
        });
        return `❌ התור ל-${appt.service.name} ב-${dateStr} ${appt.startTime} בוטל בהצלחה.`;
      }

      // ── get_business_info ────────────────────────────────────────────────────
      case "get_business_info": {
        const biz = await prisma.business.findUnique({
          where: { id: bizId },
          select: { name: true, phone: true, address: true, about: true },
        });
        if (!biz) return "מידע על העסק לא נמצא.";
        const lines = [`🏪 *${biz.name}*`];
        if (biz.address) lines.push(`📍 ${biz.address}`);
        if (biz.phone)   lines.push(`📞 ${biz.phone}`);
        if (biz.about)   lines.push(``, biz.about);
        return lines.join("\n");
      }

      // ── escalate_to_human ────────────────────────────────────────────────────
      case "escalate_to_human": {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { status: "escalated" },
        });
        return `הועבר לאדם. סיבה: ${input.reason}`;
      }

      default:
        return `כלי לא מוכר: ${name}`;
    }
  } catch (err) {
    console.error(`[agent tool ${name}]`, err);
    return `שגיאה בביצוע הפעולה: ${err instanceof Error ? err.message : "unknown"}`;
  }
}

// ─── Default system prompt ─────────────────────────────────────────────────────

/** The editable personality/rules body. Date, customer memory and FAQs are
 *  always appended around this by buildSystemPrompt — keep them out of here. */
export function defaultAgentBody(agentName: string, businessName: string): string {
  return `אתה ${agentName}, נציג השירות של ${businessName} — מספרה. אתה מתכתב עם לקוחות בוואטסאפ ועוזר להם לקבוע, לבטל ולשנות תורים, ולענות על שאלות.

דבר כמו בנאדם אמיתי שמתכתב בוואטסאפ. כתוב תשובה אחת קצרה ורציפה במשפט פשוט, בלי לפצל לשורות, בלי רשימות ובלי כותרות. אל תשים אימוג'י בכל הודעה — כמעט אף פעם, רק אם זה ממש מתבקש. אל תהיה רשמי, ואל תפתח כל הודעה ב"היי, בשמחה". פשוט תענה כמו חבר שעובד במספרה ויודע את העניינים.

הכי חשוב שלא תרגיש מטומטם או מנותק: קרא את כל השיחה לפני שאתה עונה, ותבין מה הלקוח באמת מבקש ממך. אם הוא כבר אמר משהו — שם, ספר, שירות, תאריך או שעה — אל תשאל על זה שוב בשום אופן. אסור לך לחזור על אותה שאלה או אותה הודעה פעמיים, זה הדבר שהכי מעצבן לקוחות. אם אתה מרגיש שאתה הולך במעגלים או לא מתקדם, עצור רגע, תסכם לעצמך מה כבר ברור, ותשאל בדיוק את הדבר האחד שחסר. אם באמת אי אפשר לעזור, או שהלקוח מבקש לדבר עם בנאדם, תשתמש ב-escalate_to_human במקום להמשיך להיתקע.

כדי לקבוע תור אתה צריך חמישה דברים: ספר, שירות, תאריך, שעה ושם הלקוח. שאל רק על מה שחסר, דבר אחד בכל פעם, ולפני שאתה סוגר תוודא בקצרה ובאופן טבעי שהבנת נכון. תאריכים תבין לבד ממה שהלקוח כותב, כמו "מחר", "יום ראשון" או "ה-15", והמר אותם בעצמך לפורמט YYYY-MM-DD — אל תבקש ממנו לכתוב בפורמט מסוים.

יש לך כלים: get_staff_list, get_services, get_available_slots, book_appointment, check_appointment, cancel_appointment, get_business_info ו-escalate_to_human. השתמש בהם מאחורי הקלעים כשצריך, בלי להכריז עליהם, ואל תזכיר ללקוח שמות של כלים או מספרי מזהה — דבר תמיד בשמות של ספרים ושירותים.`;
}

function buildSystemPrompt(params: {
  agentName: string;
  businessName: string;
  customSystemPrompt?: string | null;
  faqs: Array<{ question: string; answer: string }>;
  today: string;
  customerContext?: string;
}): string {
  const body =
    params.customSystemPrompt?.trim() ||
    defaultAgentBody(params.agentName, params.businessName);

  const parts = [body, `\nהתאריך היום: ${params.today}.`];

  if (params.customerContext) parts.push(`\n${params.customerContext}`);

  if (params.faqs.length) {
    parts.push(
      "\nמידע שיעזור לך לענות:\n" +
        params.faqs.map(f => `ש: ${f.question}\nת: ${f.answer}`).join("\n\n")
    );
  }

  return parts.join("\n");
}

// ─── Customer recognition ───────────────────────────────────────────────────────

/** Builds a short "who am I talking to" note from the customer's record + recent
 *  visits, so the agent recognizes a returning customer by phone — knows their
 *  name without asking, and can reference past visits. Returns "" for new numbers. */
async function loadCustomerContext(businessId: string, phone: string): Promise<string> {
  // Customer.phone may be stored as 0... or 972... — try both.
  const localPhone = phone.replace(/^972/, "0");
  const customer = await prisma.customer.findFirst({
    where: { businessId, OR: [{ phone }, { phone: localPhone }] },
    select: { id: true, name: true },
  });
  if (!customer) {
    return "זו הפעם הראשונה שהמספר הזה כותב — לקוח חדש שעדיין לא רשום אצלנו. קבל אותו בחום, ובמהלך קביעת התור שאל אותו איך קוראים לו.";
  }

  const recent = await prisma.appointment.findMany({
    where: { customerId: customer.id, businessId },
    orderBy: { date: "desc" },
    take: 3,
    select: {
      date: true,
      status: true,
      staff:   { select: { name: true } },
      service: { select: { name: true } },
    },
  });

  const parts = [
    `מי שמתכתב איתך עכשיו הוא ${customer.name}, לקוח שכבר רשום אצלנו. פנה אליו בשמו ואל תשאל אותו איך קוראים לו.`,
  ];

  const past = recent.filter(a => !a.status.startsWith("cancelled"));
  if (past.length) {
    const visits = past
      .map(a => {
        const d = new Date(a.date).toLocaleDateString("he-IL", { day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
        return `${a.service.name} אצל ${a.staff.name} ב-${d}`;
      })
      .join(", ");
    parts.push(`ביקורים אחרונים שלו: ${visits}. אם זה רלוונטי אפשר להציע את אותו ספר או שירות, אבל אל תניח — תמיד תוודא איתו.`);
  }

  return parts.join(" ");
}

// ─── Main agent function ────────────────────────────────────────────────────────

export async function runCustomerAgent(opts: {
  businessId: string;
  phone: string;        // normalized E.164
  incomingText: string;
  alreadyPersisted?: boolean;  // when true, skip saving the user message (webhook already did)
}): Promise<void> {
  const { businessId, phone, incomingText, alreadyPersisted = false } = opts;

  // ── Load business + agent config ─────────────────────────────────────────────
  const [biz, agentConfig] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, messagingProvider: true, whatsappNumber: true, greenApiInstanceId: true, greenApiToken: true },
    }),
    prisma.agentConfig.findUnique({
      where: { businessId },
      include: { faqs: { orderBy: { sortOrder: "asc" } } },
    }),
  ]);
  if (!biz) { console.error("[agent] business not found", businessId); return; }

  // ── Load or create conversation ───────────────────────────────────────────────
  let conversation = await prisma.conversation.findFirst({
    where: { businessId, phone, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { businessId, phone, agentType: "customer", status: "active" },
    });
  }

  // Save incoming user message (unless the webhook already did)
  if (!alreadyPersisted) {
    await prisma.conversationMessage.create({
      data: { conversationId: conversation.id, role: "user", content: incomingText },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
  }

  // ── Load recent dialogue ───────────────────────────────────────────────────────
  // Load the MOST RECENT user/assistant turns (not the oldest!) — tool rows are
  // internal and would otherwise crowd out real turns. Reverse to chronological.
  const history = await prisma.conversationMessage.findMany({
    where: { conversationId: conversation.id, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY,
    select: { role: true, content: true },
  });
  history.reverse();

  // Build Anthropic messages: merge consecutive same-role turns and make sure the
  // list starts with a user message (the API requires alternating roles).
  const messages: Anthropic.MessageParam[] = [];
  for (const msg of history) {
    const role: "user" | "assistant" = msg.role === "user" ? "user" : "assistant";
    const last = messages[messages.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content += "\n" + msg.content;
    } else {
      messages.push({ role, content: msg.content });
    }
  }
  while (messages.length && messages[0].role !== "user") messages.shift();

  // Recent tool activity → lets the router detect a booking already in progress.
  const recentToolRows = await prisma.conversationMessage.findMany({
    where: { conversationId: conversation.id, role: "tool" },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { toolName: true },
  });

  // Recognize the customer by phone (name + recent visits, or "new customer").
  const customerContext = await loadCustomerContext(businessId, phone);

  const systemPrompt = buildSystemPrompt({
    agentName:         agentConfig?.agentName ?? "הסוכן",
    businessName:      biz.name,
    customSystemPrompt: agentConfig?.systemPrompt,
    faqs:              agentConfig?.faqs ?? [],
    today:             new Date().toLocaleDateString("he-IL", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Jerusalem" }),
    customerContext,
  });

  // ── Agentic loop ──────────────────────────────────────────────────────────────
  let assistantText = "";
  let model = pickInitialModel(incomingText, recentToolRows.map(t => t.toolName));
  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system:     systemPrompt,
      tools:      AGENT_TOOLS,
      messages,
    });

    console.log(`[agent] model=${model} in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);

    // Append assistant response to messages
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      // Extract final text
      for (const block of response.content) {
        if (block.type === "text") assistantText += block.text;
      }
      break;
    }

    if (response.stop_reason === "tool_use") {
      // Execute all tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        if (SMART_TOOLS.has(block.name)) model = MODEL_SMART; // escalate next iteration
        const result = await execTool(
          block.name,
          block.input as Record<string, string>,
          businessId,
          conversation.id
        );
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });

        // Save tool call + result to DB
        await prisma.conversationMessage.create({
          data: {
            conversationId: conversation.id,
            role: "tool",
            content: result,
            toolName: block.name,
            toolCallId: block.id,
          },
        });
      }
      // Add tool results as user message
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // Other stop reasons (max_tokens, etc.) — just take whatever text we have
    for (const block of response.content) {
      if (block.type === "text") assistantText += block.text;
    }
    break;
  }

  if (!assistantText.trim()) return;

  // ── Save assistant reply + send via WhatsApp ──────────────────────────────────
  await prisma.conversationMessage.create({
    data: { conversationId: conversation.id, role: "assistant", content: assistantText },
  });

  await sendMessage({
    businessId,
    customerPhone: phone,
    kind:          "agent_reply",
    body:          assistantText,
  });
}
