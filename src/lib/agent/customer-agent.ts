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
import { sendMessage, firstName } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { notifyWaitlistForCancellation } from "@/lib/waitlist-notify";
import { pushToOwner } from "@/lib/native/push";
import {
  generateSlots,
  getDayOfWeek,
  timeToMinutes,
  getBusinessNow,
  addDaysISO,
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
const SMART_TOOLS = new Set(["get_available_slots", "find_next_available", "book_appointment", "cancel_appointment"]);

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
    name: "find_next_available",
    description: "מחזיר את התאריך הפנוי הקרוב ביותר ואת השעות בו, על ידי סריקה קדימה עד 30 יום. השתמש בו כשהלקוח מבקש 'התור הכי קרוב', 'הכי מהר שאפשר' או 'מתי יש מקום', במקום לבדוק יום-יום ידנית.",
    input_schema: {
      type: "object" as const,
      properties: {
        staffId:   { type: "string", description: "מזהה ספר (אופציונלי)" },
        serviceId: { type: "string", description: "מזהה שירות (אופציונלי)" },
      },
      required: [],
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
        customerName:  { type: "string", description: "שם מלא של הלקוח (שם פרטי + שם משפחה אם נמסר). אם זה לקוח חדש שאינו מזוהה במערכת, ודא שיש לך גם שם פרטי וגם שם משפחה." },
      },
      required: ["staffId", "serviceId", "date", "startTime", "customerName"],
    },
  },
  {
    name: "check_appointment",
    description: "בודק אם ללקוח (זה שמתכתב איתך עכשיו) יש תורים קרובים קיימים. אין צורך במספר טלפון — המערכת יודעת מי הלקוח.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
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
    // Cache breakpoint: the whole (static) tool block is read from cache on every
    // iteration of the loop and on follow-up turns, at ~10% of the token cost.
    cache_control: { type: "ephemeral" },
  },
];

// ─── Availability helper ───────────────────────────────────────────────────────
// Compute the free slots for ONE date, per staff member. Shared by both
// get_available_slots (single day) and find_next_available (scans forward).
async function computeDayAvailability(
  bizId: string,
  date: string,
  inputStaffId?: string,
  inputServiceId?: string,
): Promise<{ staffId: string; name: string; slots: string[]; load: number }[]> {
  const dateObj = new Date(date + "T00:00:00.000Z");
  const dayOfWeek = getDayOfWeek(dateObj);
  const nowBiz = getBusinessNow();

  const staffList = await prisma.staff.findMany({
    where: { businessId: bizId, isAvailable: true, ...(inputStaffId ? { id: inputStaffId } : {}) },
    select: { id: true, name: true, settings: true },
  });
  if (!staffList.length) return [];

  // Business-wide default booking horizon (each staff can override in settings).
  const biz = await prisma.business.findUnique({
    where: { id: bizId },
    select: { bookingHorizonDays: true },
  });
  const defaultHorizon = biz?.bookingHorizonDays ?? 30;

  const byStaff: { staffId: string; name: string; slots: string[]; load: number }[] = [];

  for (const staff of staffList) {
    // ── Booking-horizon gate (per staff) ─────────────────────────────────────
    // A date past this barber's horizon is NOT open for booking yet, even if
    // their weekly schedule says they work that weekday. Without this the agent
    // saw a far-future day as "available" for a barber whose calendar hadn't
    // opened that far and booked into a closed day. Mirrors api/slots.
    let horizonDays = defaultHorizon;
    if (staff.settings) {
      try {
        const cfg = JSON.parse(staff.settings) as Record<string, unknown>;
        if (cfg.bookingHorizonDays !== undefined) {
          const h = Number(cfg.bookingHorizonDays);
          if (!isNaN(h) && h > 0) horizonDays = h;
        }
      } catch { /* malformed settings — keep business default */ }
    }
    const lastBookableDate = addDaysISO(nowBiz.date, Math.max(0, horizonDays - 1));
    if (date > lastBookableDate) continue; // beyond this barber's horizon → not bookable

    // Service duration (specific service, else the staff's shortest).
    let duration = 30;
    if (inputServiceId) {
      const ss = await prisma.staffService.findUnique({
        where: { staffId_serviceId: { staffId: staff.id, serviceId: inputServiceId } },
        include: { service: true },
      });
      if (!ss) continue; // staff doesn't offer this service
      duration = ss.customDuration ?? ss.service.durationMinutes;
    } else {
      const firstSvc = await prisma.staffService.findFirst({
        where: { staffId: staff.id },
        include: { service: true },
        orderBy: { service: { durationMinutes: "asc" } },
      });
      duration = firstSvc?.customDuration ?? firstSvc?.service.durationMinutes ?? 30;
    }

    // Per-date override beats the weekly schedule.
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

    // `date` is stored as the full start datetime, so query the whole UTC day.
    const dayStart = dateObj;
    const dayEnd   = new Date(dateObj.getTime() + 24 * 60 * 60 * 1000);
    const booked = await prisma.appointment.findMany({
      where: { staffId: staff.id, date: { gte: dayStart, lt: dayEnd }, status: { in: ["pending", "confirmed"] } },
      select: { startTime: true, endTime: true },
    });

    let slots = generateSlots(scheduleSlots, breaks, duration, booked);

    // Drop past slots when the date is today.
    if (nowBiz.date === date) {
      slots = slots.filter(s => timeToMinutes(s) >= nowBiz.minutes + 15);
    }

    if (slots.length) byStaff.push({ staffId: staff.id, name: staff.name, slots, load: booked.length });
  }

  // When no specific barber was requested, surface the least-busy one first.
  if (!inputStaffId) byStaff.sort((a, b) => a.load - b.load);
  return byStaff;
}

// ─── Tool executors ────────────────────────────────────────────────────────────

async function execTool(
  name: string,
  input: Record<string, string>,
  bizId: string,
  conversationId: string,
  callerPhone: string
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
        const byStaff = await computeDayAvailability(bizId, date, inputStaffId, inputServiceId);
        if (!byStaff.length) return `אין תורים פנויים בתאריך ${date}.`;
        return byStaff
          .map(s => `${s.name}: ${s.slots.join(", ")}`)
          .join("\n");
      }

      // ── find_next_available ──────────────────────────────────────────────────
      // Scans forward day-by-day (up to ~30 days) and returns the FIRST date
      // that has any free slot. One call answers "the soonest appointment",
      // instead of the model probing get_available_slots day after day (which
      // blew the iteration budget and left the customer with no reply).
      case "find_next_available": {
        const { staffId: inputStaffId, serviceId: inputServiceId } = input;
        const nowBiz = getBusinessNow();
        const start = new Date(nowBiz.date + "T00:00:00.000Z");
        const MAX_SCAN_DAYS = 30;
        for (let d = 0; d < MAX_SCAN_DAYS; d++) {
          const dObj = new Date(start.getTime() + d * 24 * 60 * 60 * 1000);
          const ds = dObj.toISOString().slice(0, 10);
          const byStaff = await computeDayAvailability(bizId, ds, inputStaffId, inputServiceId);
          if (byStaff.length) {
            const lines = byStaff
              .map(s => `${s.name}: ${s.slots.slice(0, 4).join(", ")}`)
              .join("\n");
            return `התאריך הפנוי הקרוב ביותר הוא ${ds}:\n${lines}`;
          }
        }
        return `לא נמצאו תורים פנויים ב-${MAX_SCAN_DAYS} הימים הקרובים.`;
      }

      // ── book_appointment ─────────────────────────────────────────────────────
      case "book_appointment": {
        const { staffId, serviceId, date, startTime, customerName } = input;
        // The caller IS the customer — always use their WhatsApp number, never
        // a number the model invented or asked for.
        const phone = normalizeIsraeliPhone(callerPhone);

        const [staff, service, biz] = await Promise.all([
          prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, name: true } }),
          prisma.service.findUnique({ where: { id: serviceId }, select: { id: true, name: true, price: true, durationMinutes: true } }),
          prisma.business.findUnique({ where: { id: bizId }, select: { id: true, name: true } }),
        ]);
        if (!staff || !service || !biz) return "שגיאה: לא נמצא הספר או השירות לפי המזהה. קרא שוב ל-get_staff_list ו-get_services כדי לקבל מזהים מעודכנים, ואז נסה לקבוע שוב — אל תעביר לאדם בגלל זה.";

        // ── Hard availability guard ──────────────────────────────────────────
        // NEVER create an appointment on a slot that isn't genuinely open for
        // THIS barber on THIS date — i.e. a closed day, a date beyond the
        // barber's booking horizon, or a slot already taken. computeDayAvailability
        // is the single source of truth (it applies schedule, overrides, horizon
        // and existing bookings), so re-check the exact slot here before writing.
        const dayAvail = await computeDayAvailability(bizId, date, staffId, serviceId);
        const staffSlots = dayAvail.find(s => s.staffId === staffId)?.slots ?? [];
        if (!staffSlots.includes(startTime)) {
          return `שגיאה: ${startTime} בתאריך ${date} לא פנוי אצל ${staff.name} (יום סגור, מעבר לאופק ההזמנות, או שהשעה נתפסה). אל תקבע את זה. קרא ל-get_available_slots לאותו יום או ל-find_next_available כדי לראות מה באמת פנוי, והצע ללקוח אפשרות תקפה — אצל ספר שפתוח באותו יום.`;
        }

        // Upsert customer — match either 0... or 972... so we don't duplicate.
        const localPhone = phone.replace(/^972/, "0");
        let customer = await prisma.customer.findFirst({ where: { businessId: bizId, OR: [{ phone }, { phone: localPhone }] } });
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

        // Calculate times.
        // ⚠️ The `date` column MUST be stored at UTC midnight (00:00:00Z) — the
        // public availability queries match the day by exact UTC-midnight value,
        // so baking the start time into `date` makes the appointment invisible to
        // them and causes double-booking. Keep the start time only in `startTime`.
        const apptDate = new Date(`${date}T00:00:00.000Z`);
        const startDateTime = new Date(`${date}T${startTime}:00.000Z`);
        const endDate  = new Date(startDateTime.getTime() + service.durationMinutes * 60_000);
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
            source:    "agent",
          },
        });

        return `✅ תור נקבע בהצלחה!\n📅 ${date} ב-${startTime}\n💈 ${service.name} אצל ${staff.name}\n💰 ${service.price}₪\nמזהה תור: ${appt.id}`;
      }

      // ── check_appointment ────────────────────────────────────────────────────
      case "check_appointment": {
        // Customer.phone may be stored as 0... or 972... — match either.
        const phone = normalizeIsraeliPhone(callerPhone);
        const localPhone = phone.replace(/^972/, "0");
        const customer = await prisma.customer.findFirst({
          where: { businessId: bizId, OR: [{ phone }, { phone: localPhone }] },
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

המטרה שלך תמיד לעזור ללקוח לסגור תור, בטבעיות ובלי לחץ. גם אם הוא שאל רק על מחיר, על שעות או על שירות מסוים — ענה לו, ומיד אחרי זה הצע לו לקבוע, בלי לחכות שיבקש (למשל "רוצה שאתפוס לך תור?"). תמיד קדם את השיחה צעד אחד קדימה לכיוון קביעת התור. אם הלקוח אומר שהוא לא רוצה כרגע — אל תלחץ ואל תחזור על ההצעה שוב ושוב.

כדי לקבוע תור אתה צריך חמישה דברים: ספר, שירות, תאריך, שעה ושם הלקוח. שאל רק על מה שחסר, דבר אחד בכל פעם, ולפני שאתה סוגר תוודא בקצרה ובאופן טבעי שהבנת נכון. תאריכים תבין לבד ממה שהלקוח כותב, כמו "מחר", "יום ראשון" או "ה-15", והמר אותם בעצמך לפורמט YYYY-MM-DD — אל תבקש ממנו לכתוב בפורמט מסוים.

חשוב מאוד: אתה כבר יודע את מספר הטלפון של מי שמתכתב איתך, והכלים משתמשים בו אוטומטית. לעולם אל תבקש מהלקוח מספר טלפון — לא כדי לקבוע, לא כדי לאתר תור ולא כדי לבטל. אם אתה צריך לראות אם יש לו תור קיים, פשוט תשתמש ב-check_appointment והמערכת תמצא לפי המספר שלו.

לפני שאתה בכלל מחפש שעות, תוודא שהבנת עד הסוף מה הלקוח רוצה — איזה יום, ובוקר/צהריים/ערב או שעה מסוימת, ואם ביקש ספר מסוים. רק כשזה ברור, קרא פעם אחת ל-get_available_slots — אל תחפש שוב ושוב באמצע. אם הלקוח לא ביקש ספר מסוים, בדוק אצל כל הספרים; אסור להגיד שאין שעה לפני שבדקת אצל כולם, ואם אצל אחד אין אבל אצל אחר יש — תגיד שיש ואצל מי. הצג ללקוח רק את השעות שמתאימות למה שביקש (למשל רק שעות ערב אם ביקש ערב), לא רשימה ענקית. אם הוא מבקש "מה עוד יש" או אפשרויות נוספות — תן לו עוד מתוך אותן שעות שכבר קיבלת, בלי לחפש מחדש.

כדי להזיז או לשנות תור: קודם מצא את התור הקיים עם check_appointment, ספר ללקוח מה קבוע לו, ואחרי שהוא מאשר — בטל את הישן עם cancel_appointment וקבע את החדש עם book_appointment. אל תבקש ממנו פרטים שכבר יש לך מהתור הקיים.

יש לך כלים: get_staff_list, get_services, get_available_slots, find_next_available, book_appointment, check_appointment, cancel_appointment, get_business_info ו-escalate_to_human. כשהלקוח מבקש את התור הכי קרוב או "מתי יש מקום" — קרא ל-find_next_available במקום לבדוק יום-יום. השתמש בהם מאחורי הקלעים כשצריך, בלי להכריז עליהם, ואל תזכיר ללקוח שמות של כלים או מספרי מזהה — דבר תמיד בשמות של ספרים ושירותים.`;
}

function buildSystemPrompt(params: {
  agentName: string;
  businessName: string;
  customSystemPrompt?: string | null;
  faqs: Array<{ question: string; answer: string }>;
  now: string;
  customerContext?: string;
}): Anthropic.TextBlockParam[] {
  const body =
    params.customSystemPrompt?.trim() ||
    defaultAgentBody(params.agentName, params.businessName);

  // Stable, business-level chunk (personality + FAQs). Identical across every
  // iteration of the tool loop AND across turns/customers, so we cache it — the
  // 2nd..Nth call reads it at ~10% of the token cost (5-min cache TTL).
  let stable = body;
  if (params.faqs.length) {
    stable +=
      "\n\nמידע שיעזור לך לענות:\n" +
      params.faqs.map(f => `ש: ${f.question}\nת: ${f.answer}`).join("\n\n");
  }

  // Per-turn chunk (current time + who's chatting). Changes every minute and
  // per customer, so it must stay OUTSIDE the cached prefix.
  let dynamic =
    `התאריך והשעה כרגע: ${params.now}. התחשב בשעה הנוכחית — אם כבר מאוחר אל תציע תור להיום, והצע אפשרויות טבעיות לפי היום בשבוע (למשל "מחר או בהמשך השבוע", ובסוף שבוע "ראשון הקרוב").`;
  if (params.customerContext) dynamic += `\n${params.customerContext}`;

  return [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamic },
  ];
}

// ─── Customer recognition ───────────────────────────────────────────────────────

/** Builds a short "who am I talking to" note from the customer's record + recent
 *  visits, so the agent recognizes a returning customer by phone — knows their
 *  name without asking, and can reference past visits. Returns "" for new numbers. */
async function loadCustomerContext(businessId: string, phone: string): Promise<string> {
  // Customer.phone may be stored as 0... or 972... — try both. The same number
  // can sadly exist under BOTH formats as two separate records (with different
  // names), so fetch every match and pick deterministically: the one with the
  // most appointments (the real, active customer), then the most recent.
  const localPhone = phone.replace(/^972/, "0");
  const candidates = await prisma.customer.findMany({
    where: { businessId, OR: [{ phone }, { phone: localPhone }] },
    select: { id: true, name: true, createdAt: true },
  });
  if (!candidates.length) {
    return "זו הפעם הראשונה שהמספר הזה כותב — לקוח חדש שעדיין לא רשום אצלנו. קבל אותו בחום, ובמהלך קביעת התור שאל אותו איך קוראים לו.";
  }

  let customer = candidates[0];
  if (candidates.length > 1) {
    const counts = await prisma.appointment.groupBy({
      by: ["customerId"],
      where: { businessId, customerId: { in: candidates.map(c => c.id) } },
      _count: { _all: true },
    });
    const load = new Map(counts.map(c => [c.customerId, c._count._all]));
    customer = [...candidates].sort((a, b) =>
      (load.get(b.id) ?? 0) - (load.get(a.id) ?? 0) ||
      b.createdAt.getTime() - a.createdAt.getTime()
    )[0];
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

  const fname = firstName(customer.name);
  const parts = [
    `מי שמתכתב איתך עכשיו הוא ${fname}, לקוח שכבר רשום אצלנו. פנה אליו בשם הפרטי בלבד (${fname}) — לעולם לא בשם המלא או בשם משפחה — ואל תשאל אותו איך קוראים לו. רק אם זו ההודעה הראשונה ממש בשיחה הזו והלקוח עוד לא ביקש כלום, פתח בברכה אישית קצרה בשמו (למשל "היי ${fname}, מה נשמע?"). אם הלקוח כבר באמצע משהו (שאל שאלה, מבקש לקבוע, באמצע קביעת תור) — אל תפתח בברכה כללית ואל תכתוב "מה נוכל לעזור לך היום", פשוט תמשיך ענייני בדיוק מאיפה שהשיחה נמצאת. בהמשך השיחה אל תחזור על הברכה בכל הודעה.`,
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

  // Active waitlist entries — the customer explicitly asked to be queued for a
  // specific barber. If they come to book, that barber is the one they actually
  // want, so prefer them instead of auto-assigning the least-busy one.
  const todayIso = getBusinessNow().date;
  const waits = await prisma.waitlist.findMany({
    where: {
      customerId: customer.id,
      businessId,
      status: { in: ["waiting", "notified"] },
      date: { gte: new Date(`${todayIso}T00:00:00.000Z`) },
    },
    orderBy: { date: "asc" },
    take: 3,
    select: { date: true, staff: { select: { name: true } }, service: { select: { name: true } } },
  });
  const waitsWithStaff = waits.filter(w => w.staff);
  if (waitsWithStaff.length) {
    const list = waitsWithStaff
      .map(w => {
        const d = new Date(w.date).toLocaleDateString("he-IL", { day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
        return `${w.staff!.name} (${w.service.name}, ${d})`;
      })
      .join(", ");
    parts.push(`הוא רשום ברשימת המתנה אצל: ${list}. אם הוא רוצה לקבוע תור, קבע אותו אצל הספר שאצלו הוא בהמתנה — זה הספר שהוא ביקש — ולא אצל ספר אחר.`);
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
    now:               new Date().toLocaleString("he-IL", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" }),
    customerContext,
  });

  // ── Agentic loop ──────────────────────────────────────────────────────────────
  let assistantText = "";
  let model = pickInitialModel(incomingText, recentToolRows.map(t => t.toolName));
  // A reschedule legitimately chains many tools (check + slots + cancel +
  // services + staff + book), so keep enough headroom to also compose a reply.
  const MAX_ITERATIONS = 8;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system:     systemPrompt,
      tools:      AGENT_TOOLS,
      messages,
    });

    const u = response.usage;
    console.log(
      `[agent] model=${model} in=${u.input_tokens} out=${u.output_tokens} ` +
      `cacheWrite=${u.cache_creation_input_tokens ?? 0} cacheRead=${u.cache_read_input_tokens ?? 0}`
    );

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
          conversation.id,
          phone
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

  // Safety net: if the model burned through its tool budget without ever
  // composing a reply (e.g. a reschedule that ran check+cancel+book), the action
  // already happened — so force one final text-only turn instead of going silent.
  if (!assistantText.trim()) {
    const closing = await anthropic.messages.create({
      model:    MODEL_SMART,
      max_tokens: 1024,
      system:   systemPrompt,
      messages, // includes every tool result so far
    });
    for (const block of closing.content) {
      if (block.type === "text") assistantText += block.text;
    }
  }

  if (!assistantText.trim()) return;

  // ── Save assistant reply + send via WhatsApp ──────────────────────────────────
  // A blank line means "send as a separate WhatsApp bubble" — lets the agent open
  // with a personal greeting ("היי יאיר, מה נשמע?") and then follow up, the way a
  // human texts. Within each bubble there are no line breaks.
  const bubbles = assistantText.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);

  for (let i = 0; i < bubbles.length; i++) {
    await prisma.conversationMessage.create({
      data: { conversationId: conversation.id, role: "assistant", content: bubbles[i] },
    });
    await sendMessage({
      businessId,
      customerPhone: phone,
      kind:          "agent_reply",
      body:          bubbles[i],
    });
    // Small human-like pause between bubbles so they arrive in order, not at once.
    if (i < bubbles.length - 1) await new Promise(r => setTimeout(r, 700));
  }
}
