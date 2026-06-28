/**
 * Owner Agent — the shop owner's personal WhatsApp assistant.
 *
 * The owner (or a staff member granted `canUseOwnerAgent`) sends commands to the
 * SAME business WhatsApp number that customers use. The webhook detects that the
 * sender is staff and routes here instead of to the customer agent. Unlike the
 * customer agent, this one has full authority: it swaps appointments, cancels,
 * and broadcasts directly — no customer pre-approval, just a notification after.
 *
 * Always runs on the strong model (Sonnet). Keeps its own conversation thread
 * (agentType="owner") for cross-message memory, hidden from the customer inbox.
 */

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { sendMessage, firstName } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { getBusinessNow, timeToMinutes, minutesToTime } from "@/lib/utils";
import { computeDayAvailability, resolveStaffService } from "@/lib/agent/availability";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const MODEL_SMART = "claude-sonnet-4-6";
const MAX_HISTORY = 16;
const MAX_ITERATIONS = 8;

const ACTIVE_STATUSES = ["pending", "confirmed"];

function hebDayLabel(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00.000Z`).toLocaleDateString("he-IL", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem",
  });
}

// ── Tool schemas ──────────────────────────────────────────────────────────────
const OWNER_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_schedule",
    description:
      "מחזיר את לוח התורים ליום נתון (ברירת מחדל: היום). כולל שם לקוח, שירות, ספר, שעה, ומזהה התור (appointment ID) שצריך לפעולות אחרות. השתמש בזה תמיד לפני החלפה/ביטול כדי לאמת על איזה תור מדובר.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "תאריך בפורמט YYYY-MM-DD. אם לא צוין — היום." },
      },
    },
  },
  {
    name: "swap_appointments",
    description:
      "מחליף את השעות בין שני תורים (שניהם באותו עסק). מעדכן ישירות במסד ושולח הודעת WhatsApp מיידית לשני הלקוחות שהתור שלהם עבר. השתמש רק אחרי שאימתת עם get_schedule.",
    input_schema: {
      type: "object",
      properties: {
        appointment_id_1: { type: "string", description: "מזהה התור הראשון" },
        appointment_id_2: { type: "string", description: "מזהה התור השני" },
      },
      required: ["appointment_id_1", "appointment_id_2"],
    },
  },
  {
    name: "move_appointment",
    description:
      "מזיז תור בודד לשעה (ואופציונלית תאריך) חדשים — בלי קשר ללקוח אחר. משך השירות נשמר. שולח הודעת WhatsApp מיידית ללקוח. אם השעה החדשה תפוסה אצל אותו ספר, הכלי יחזיר אזהרה ולא יבצע — אלא אם תעביר force=true.",
    input_schema: {
      type: "object",
      properties: {
        appointment_id: { type: "string", description: "מזהה התור להזזה" },
        new_time: { type: "string", description: "השעה החדשה בפורמט HH:MM" },
        new_date: { type: "string", description: "תאריך חדש YYYY-MM-DD (אופציונלי — ברירת מחדל: אותו יום)" },
        force: { type: "boolean", description: "להזיז גם אם השעה תפוסה (יוצר כפל). ברירת מחדל: false" },
      },
      required: ["appointment_id", "new_time"],
    },
  },
  {
    name: "book_for_customer",
    description:
      "קובע תור חדש ללקוח בשעה מסוימת. השתמש קודם ב-get_staff_and_services כדי לקבל staff_id ו-service_id, וב-get_customer_info כדי לאתר לקוח קיים. אם הלקוח קיים — אפשר רק שם. ללקוח חדש — צריך גם טלפון. שולח אישור ללקוח אם יש לו טלפון.",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "שם הלקוח (מלא ללקוח חדש)" },
        customer_phone: { type: "string", description: "טלפון הלקוח (חובה ללקוח חדש; אופציונלי אם הלקוח כבר קיים)" },
        staff_id: { type: "string", description: "מזהה הספר" },
        service_id: { type: "string", description: "מזהה השירות" },
        date: { type: "string", description: "תאריך YYYY-MM-DD" },
        time: { type: "string", description: "שעה HH:MM" },
        force: { type: "boolean", description: "לקבוע גם אם השעה לא פנויה לפי הלוח. ברירת מחדל: false" },
      },
      required: ["customer_name", "staff_id", "service_id", "date", "time"],
    },
  },
  {
    name: "get_staff_and_services",
    description: "מחזיר את רשימת הספרים והשירותים עם המזהים (id), משך ומחיר. נדרש לפני קביעת תור.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cancel_appointment",
    description: "מבטל תור לפי מזהה. אופציונלית שולח הודעת ביטול ללקוח.",
    input_schema: {
      type: "object",
      properties: {
        appointment_id: { type: "string", description: "מזהה התור לביטול" },
        notify_customer: { type: "boolean", description: "האם לשלוח הודעת ביטול ללקוח (ברירת מחדל: true)" },
        reason: { type: "string", description: "סיבה אופציונלית שתופיע בהודעה ללקוח" },
      },
      required: ["appointment_id"],
    },
  },
  {
    name: "send_to_today_customers",
    description:
      "שולח הודעה חופשית לכל הלקוחות שיש להם תור היום. ההודעות נשלחות בהדרגה (כדקה בין הודעה להודעה) כדי לא לחסום את המספר. החזר ללקוח כמה אנשים יקבלו וכמה זמן זה ייקח.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "תוכן ההודעה לשליחה לכל לקוחות היום" },
      },
      required: ["message"],
    },
  },
  {
    name: "get_customer_info",
    description: "מחפש לקוח לפי שם או טלפון ומחזיר את פרטיו והתורים העתידיים שלו.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "שם או מספר טלפון לחיפוש" },
      },
      required: ["query"],
    },
  },
];

// ── Tool executor ───────────────────────────────────────────────────────────
async function execOwnerTool(
  name: string,
  input: Record<string, unknown>,
  businessId: string
): Promise<string> {
  switch (name) {
    // ── Schedule for a day ──────────────────────────────────────────────────
    case "get_schedule": {
      const dateIso = (input.date as string) || getBusinessNow().date;
      const dayStart = new Date(`${dateIso}T00:00:00.000Z`);
      const dayEnd = new Date(`${dateIso}T23:59:59.999Z`);
      const appts = await prisma.appointment.findMany({
        where: {
          businessId,
          date: { gte: dayStart, lte: dayEnd },
          status: { in: ACTIVE_STATUSES },
        },
        include: {
          customer: { select: { name: true, phone: true } },
          staff: { select: { name: true } },
          service: { select: { name: true } },
        },
        orderBy: { startTime: "asc" },
      });
      if (!appts.length) return `אין תורים פעילים ב-${hebDayLabel(dateIso)} (${dateIso}).`;
      const lines = appts.map(
        a =>
          `${a.startTime}–${a.endTime} | ${a.customer.name} | ${a.service.name} | ${a.staff.name} | id=${a.id}`
      );
      return `לוח ${hebDayLabel(dateIso)} (${dateIso}) — ${appts.length} תורים:\n${lines.join("\n")}`;
    }

    // ── Swap two appointments' times ────────────────────────────────────────
    case "swap_appointments": {
      const id1 = input.appointment_id_1 as string;
      const id2 = input.appointment_id_2 as string;
      if (!id1 || !id2 || id1 === id2) return "שגיאה: צריך שני מזהי תורים שונים.";

      const [a1, a2] = await Promise.all([
        prisma.appointment.findUnique({
          where: { id: id1 },
          include: { customer: true, staff: true, service: true },
        }),
        prisma.appointment.findUnique({
          where: { id: id2 },
          include: { customer: true, staff: true, service: true },
        }),
      ]);
      if (!a1 || a1.businessId !== businessId) return `שגיאה: תור ${id1} לא נמצא בעסק.`;
      if (!a2 || a2.businessId !== businessId) return `שגיאה: תור ${id2} לא נמצא בעסק.`;
      if (!ACTIVE_STATUSES.includes(a1.status) || !ACTIVE_STATUSES.includes(a2.status)) {
        return "שגיאה: אחד התורים כבר מבוטל/הושלם — אי אפשר להחליף.";
      }

      // Atomic swap of times (date + start + end). Each keeps its own staff/service.
      await prisma.$transaction([
        prisma.appointment.update({
          where: { id: a1.id },
          data: { date: a2.date, startTime: a2.startTime, endTime: a2.endTime },
        }),
        prisma.appointment.update({
          where: { id: a2.id },
          data: { date: a1.date, startTime: a1.startTime, endTime: a1.endTime },
        }),
      ]);

      // Notify both customers immediately (they need to know now, not via drip).
      const notify = async (
        appt: typeof a1,
        fromTime: string,
        toTime: string,
        toDateIso: string
      ) => {
        if (!appt.customer.phone) return false;
        const sameDay = new Date(appt.date).toISOString().slice(0, 10) === toDateIso;
        const when = sameDay
          ? `מ-${fromTime} ל-${toTime}`
          : `ל-${hebDayLabel(toDateIso)} בשעה ${toTime}`;
        const body =
          `היי ${firstName(appt.customer.name)}, עדכון לגבי התור שלך ב-DOMINANT — ` +
          `הוא הועבר ${when}. נתראה!`;
        const res = await sendMessage({
          businessId,
          customerPhone: appt.customer.phone,
          kind: "appointment_moved",
          body,
        });
        return res.ok;
      };

      const toDate2 = new Date(a2.date).toISOString().slice(0, 10);
      const toDate1 = new Date(a1.date).toISOString().slice(0, 10);
      const [sent1, sent2] = await Promise.all([
        notify(a1, a1.startTime, a2.startTime, toDate2),
        notify(a2, a2.startTime, a1.startTime, toDate1),
      ]);

      return (
        `הוחלף: ${a1.customer.name} (היה ${a1.startTime}) ↔ ${a2.customer.name} (היה ${a2.startTime}).\n` +
        `הודעות נשלחו: ${a1.customer.name}=${sent1 ? "כן" : "נכשל"}, ${a2.customer.name}=${sent2 ? "כן" : "נכשל"}.`
      );
    }

    // ── Staff + services catalog (for booking) ──────────────────────────────
    case "get_staff_and_services": {
      const [staff, services] = await Promise.all([
        prisma.staff.findMany({
          where: { businessId, isActive: true },
          select: { id: true, name: true, role: true },
          orderBy: { sortOrder: "asc" },
        }),
        prisma.service.findMany({
          where: { businessId },
          select: { id: true, name: true, durationMinutes: true, price: true },
          orderBy: { name: "asc" },
        }),
      ]);
      const staffLines = staff.map(s => `${s.name} | id=${s.id}`).join("\n");
      const svcLines = services
        .map(s => `${s.name} | ${s.durationMinutes} דק' | ${s.price}₪ | id=${s.id}`)
        .join("\n");
      return `ספרים:\n${staffLines}\n\nשירותים:\n${svcLines}`;
    }

    // ── Move a single appointment to a new time/date ────────────────────────
    case "move_appointment": {
      const id = input.appointment_id as string;
      const newTime = input.new_time as string;
      const force = input.force === true;
      if (!/^\d{1,2}:\d{2}$/.test(newTime || "")) return "שגיאה: שעה לא תקינה (צריך HH:MM).";

      const appt = await prisma.appointment.findUnique({
        where: { id },
        include: { customer: true, staff: true, service: true },
      });
      if (!appt || appt.businessId !== businessId) return `שגיאה: תור ${id} לא נמצא בעסק.`;
      if (!ACTIVE_STATUSES.includes(appt.status)) return "התור כבר אינו פעיל (מבוטל/הושלם).";

      const curDateIso = new Date(appt.date).toISOString().slice(0, 10);
      const newDateIso = (input.new_date as string) || curDateIso;
      const duration = timeToMinutes(appt.endTime) - timeToMinutes(appt.startTime);
      const newEnd = minutesToTime(timeToMinutes(newTime) + duration);

      // Conflict check — same barber, same day, overlapping, different appointment.
      if (!force) {
        const dayStart = new Date(`${newDateIso}T00:00:00.000Z`);
        const dayEnd = new Date(`${newDateIso}T23:59:59.999Z`);
        const sameDayAppts = await prisma.appointment.findMany({
          where: {
            businessId, staffId: appt.staffId, id: { not: appt.id },
            date: { gte: dayStart, lte: dayEnd }, status: { in: ACTIVE_STATUSES },
          },
          include: { customer: { select: { name: true } } },
        });
        const ns = timeToMinutes(newTime);
        const ne = timeToMinutes(newEnd);
        const clash = sameDayAppts.find(a => {
          const as = timeToMinutes(a.startTime);
          const ae = timeToMinutes(a.endTime);
          return ns < ae && as < ne; // overlap
        });
        if (clash) {
          return `שים לב: ב-${newTime} (${newDateIso}) כבר יש תור אצל ${appt.staff.name} — ${clash.customer.name} (${clash.startTime}–${clash.endTime}). אם בכל זאת להזיז ולגרום לכפל, קרא שוב עם force=true. אחרת אפשר להחליף ביניהם עם swap_appointments.`;
        }
      }

      const newDate = new Date(`${newDateIso}T00:00:00.000Z`);
      try {
        await prisma.appointment.update({
          where: { id: appt.id },
          data: { date: newDate, startTime: newTime, endTime: newEnd },
        });
      } catch (err: unknown) {
        if ((err as { code?: string }).code === "P2002") {
          return `שגיאה: ${newTime} ב-${newDateIso} כבר תפוס אצל ${appt.staff.name}. הצע שעה אחרת או החלפה.`;
        }
        throw err;
      }

      let notified = false;
      if (appt.customer.phone) {
        const sameDay = newDateIso === curDateIso;
        const when = sameDay
          ? `מ-${appt.startTime} ל-${newTime}`
          : `ל-${hebDayLabel(newDateIso)} בשעה ${newTime}`;
        const res = await sendMessage({
          businessId,
          customerPhone: appt.customer.phone,
          kind: "appointment_moved",
          body: `היי ${firstName(appt.customer.name)}, עדכון לגבי התור שלך ב-DOMINANT — הוא הועבר ${when}. נתראה!`,
        });
        notified = res.ok;
      }
      return `הוזז: ${appt.customer.name} → ${newDateIso} ${newTime}–${newEnd} (${appt.staff.name}). הודעה ללקוח: ${appt.customer.phone ? (notified ? "נשלחה" : "נכשלה") : "אין טלפון"}.`;
    }

    // ── Book a new appointment for a customer ───────────────────────────────
    case "book_for_customer": {
      const staffId = input.staff_id as string;
      const serviceId = input.service_id as string;
      const date = input.date as string;
      const time = input.time as string;
      const customerName = ((input.customer_name as string) || "").trim();
      const rawPhone = ((input.customer_phone as string) || "").trim();
      const force = input.force === true;
      if (!customerName) return "שגיאה: חסר שם לקוח.";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return "שגיאה: תאריך לא תקין (YYYY-MM-DD).";
      if (!/^\d{1,2}:\d{2}$/.test(time || "")) return "שגיאה: שעה לא תקינה (HH:MM).";

      const [staff, service] = await Promise.all([
        prisma.staff.findFirst({ where: { id: staffId, businessId }, select: { id: true, name: true } }),
        prisma.service.findUnique({ where: { id: serviceId }, select: { id: true, name: true, price: true, durationMinutes: true } }),
      ]);
      if (!staff) return "שגיאה: ספר לא נמצא. קרא ל-get_staff_and_services לקבלת מזהים.";
      if (!service) return "שגיאה: שירות לא נמצא. קרא ל-get_staff_and_services לקבלת מזהים.";

      // Availability guard (owner may override with force).
      if (!force) {
        const dayAvail = await computeDayAvailability(businessId, date, staffId, serviceId);
        const slots = dayAvail.find(s => s.staffId === staffId)?.slots ?? [];
        if (!slots.includes(time)) {
          return `שים לב: ${time} ב-${date} לא פנוי אצל ${staff.name} (יום סגור / מעבר לאופק / תפוס). אם בכל זאת לקבוע, קרא שוב עם force=true. אחרת קרא ל-get_schedule כדי לראות מה תפוס.`;
        }
      }

      // Find or create the customer.
      const phone = rawPhone ? normalizeIsraeliPhone(rawPhone) : "";
      let customer: { id: string; name: string; phone: string } | null = null;
      if (phone) {
        const local = phone.replace(/^972/, "0");
        customer = await prisma.customer.findFirst({
          where: { businessId, OR: [{ phone }, { phone: local }] },
          select: { id: true, name: true, phone: true },
        });
      }
      if (!customer) {
        // Match by name (substring, so a first name finds "ניקה לובקובסקי" too).
        const matches = await prisma.customer.findMany({
          where: { businessId, name: { contains: customerName, mode: "insensitive" } },
          select: { id: true, name: true, phone: true },
          take: 6,
        });
        if (matches.length === 1) {
          customer = matches[0];
        } else if (matches.length > 1) {
          const list = matches.map(m => `${m.name} (${m.phone})`).join(", ");
          return `יש כמה לקוחות שמתאימים ל-"${customerName}": ${list}. ציין טלפון מדויק (customer_phone) או שם מלא כדי שאדע למי לקבוע.`;
        }
      }
      if (!customer) {
        if (!phone) {
          return "שגיאה: לא נמצא לקוח קיים בשם הזה, ולקוח חדש חייב מספר טלפון. בקש מהבעלים את הטלפון של הלקוח וקרא שוב עם customer_phone.";
        }
        customer = await prisma.customer.create({
          data: { businessId, name: customerName, phone, referralSource: "owner_agent" },
          select: { id: true, name: true, phone: true },
        });
      }

      const eff = await resolveStaffService(staffId, serviceId, service.name, service.durationMinutes, service.price);
      const apptDate = new Date(`${date}T00:00:00.000Z`);
      const endTime = minutesToTime(timeToMinutes(time) + eff.duration);

      let appt;
      try {
        appt = await prisma.appointment.create({
          data: {
            businessId, customerId: customer.id, staffId, serviceId,
            date: apptDate, startTime: time, endTime,
            status: "confirmed", price: eff.price,
            referralSource: "owner_agent", source: "admin",
          },
        });
      } catch (err: unknown) {
        if ((err as { code?: string }).code === "P2002") {
          return `שגיאה: ${time} ב-${date} כבר תפוס אצל ${staff.name}. הצע שעה אחרת.`;
        }
        throw err;
      }

      let notified = false;
      if (customer.phone) {
        const res = await sendMessage({
          businessId,
          customerPhone: customer.phone,
          kind: "confirmation",
          body: `היי ${firstName(customer.name)}, נקבע לך תור ב-DOMINANT ל-${hebDayLabel(date)} בשעה ${time} — ${service.name} אצל ${staff.name}. נתראה!`,
        });
        notified = res.ok;
      }
      return `נקבע: ${customer.name} | ${date} ${time}–${endTime} | ${service.name} אצל ${staff.name} | ${eff.price}₪. אישור ללקוח: ${customer.phone ? (notified ? "נשלח" : "נכשל") : "אין טלפון"}. id=${appt.id}`;
    }

    // ── Cancel an appointment ───────────────────────────────────────────────
    case "cancel_appointment": {
      const id = input.appointment_id as string;
      const notifyCustomer = input.notify_customer !== false; // default true
      const reason = (input.reason as string) || "";
      const appt = await prisma.appointment.findUnique({
        where: { id },
        include: { customer: true },
      });
      if (!appt || appt.businessId !== businessId) return `שגיאה: תור ${id} לא נמצא בעסק.`;
      if (!ACTIVE_STATUSES.includes(appt.status)) return "התור כבר אינו פעיל (מבוטל/הושלם).";

      await prisma.appointment.update({
        where: { id },
        data: { status: "cancelled_by_staff", cancelledAt: new Date() },
      });

      let notified = false;
      if (notifyCustomer && appt.customer.phone) {
        const dateIso = new Date(appt.date).toISOString().slice(0, 10);
        const body =
          `היי ${firstName(appt.customer.name)}, התור שלך ב-DOMINANT ל-${hebDayLabel(dateIso)} ` +
          `בשעה ${appt.startTime} בוטל${reason ? ` (${reason})` : ""}. ` +
          `מוזמן לתאם תור חדש מתי שנוח לך.`;
        const res = await sendMessage({
          businessId,
          customerPhone: appt.customer.phone,
          kind: "swap_cancelled",
          body,
        });
        notified = res.ok;
      }
      return `בוטל התור של ${appt.customer.name} (${appt.startTime}). ${notifyCustomer ? `הודעה ללקוח: ${notified ? "נשלחה" : "נכשלה"}.` : "לא נשלחה הודעה."}`;
    }

    // ── Broadcast to today's customers ──────────────────────────────────────
    case "send_to_today_customers": {
      const message = (input.message as string)?.trim();
      if (!message) return "שגיאה: ההודעה ריקה.";
      const dateIso = getBusinessNow().date;
      const dayStart = new Date(`${dateIso}T00:00:00.000Z`);
      const dayEnd = new Date(`${dateIso}T23:59:59.999Z`);
      const appts = await prisma.appointment.findMany({
        where: {
          businessId,
          date: { gte: dayStart, lte: dayEnd },
          status: { in: ACTIVE_STATUSES },
        },
        select: { customer: { select: { name: true, phone: true } } },
      });
      // Unique by phone
      const byPhone = new Map<string, string>();
      for (const a of appts) {
        if (a.customer.phone) byPhone.set(a.customer.phone, a.customer.name);
      }
      if (byPhone.size === 0) return "אין לקוחות עם תור היום — לא נשלח כלום.";

      // Ban-safe drip: stagger ~1/min, drained by the drip-queue cron.
      const INTERVAL_SEC = 60;
      const now = Date.now();
      const rows = Array.from(byPhone.entries()).map(([phone, name], i) => {
        const jitterMs = Math.floor((Math.random() * 20 - 10) * 1000);
        return {
          businessId,
          customerPhone: phone,
          kind: "broadcast",
          body: message.replace(/\{name\}/g, firstName(name)),
          status: "scheduled",
          scheduledFor: new Date(now + i * INTERVAL_SEC * 1000 + jitterMs),
        };
      });
      await prisma.messageLog.createMany({ data: rows });
      const etaMin = Math.ceil((byPhone.size * INTERVAL_SEC) / 60);
      return `ההודעה תישלח ל-${byPhone.size} לקוחות. זמן משוער: כ-${etaMin} דק'.`;
    }

    // ── Customer lookup ─────────────────────────────────────────────────────
    case "get_customer_info": {
      const q = (input.query as string)?.trim();
      if (!q) return "שגיאה: חיפוש ריק.";
      // Only add the phone clause when the query actually has digits — otherwise
      // `contains ""` matches EVERY customer and floods the result with noise.
      const digits = q.replace(/\D/g, "");
      const customers = await prisma.customer.findMany({
        where: {
          businessId,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            ...(digits ? [{ phone: { contains: digits } }] : []),
          ],
        },
        take: 8,
        select: {
          id: true, name: true, phone: true,
          appointments: {
            where: { date: { gte: new Date(`${getBusinessNow().date}T00:00:00.000Z`) }, status: { in: ACTIVE_STATUSES } },
            orderBy: { date: "asc" },
            take: 3,
            include: { staff: { select: { name: true } }, service: { select: { name: true } } },
          },
        },
      });
      if (!customers.length) return `לא נמצא לקוח התואם ל-"${q}".`;
      return customers
        .map(c => {
          const upcoming = c.appointments.length
            ? c.appointments
                .map(a => `  • ${new Date(a.date).toISOString().slice(0, 10)} ${a.startTime} ${a.service.name} (${a.staff.name}) id=${a.id}`)
                .join("\n")
            : "  אין תורים עתידיים";
          return `${c.name} | ${c.phone ?? "ללא טלפון"}\n${upcoming}`;
        })
        .join("\n\n");
    }

    default:
      return `שגיאה: כלי לא מוכר (${name}).`;
  }
}

// ── System prompt (hardcoded — not from DB) ───────────────────────────────────
function ownerSystemPrompt(ownerName: string, businessName: string): string {
  const now = new Date().toLocaleString("he-IL", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jerusalem",
  });
  return [
    `אתה העוזר האישי של ${ownerName}, בעל ${businessName}.`,
    `אתה מקבל ממנו פקודות ישירות בוואטסאפ ומבצע אותן. יש לך סמכות מלאה — אין צורך באישור לקוח.`,
    `ענה קצר וענייני: פעולה + אישור. אל תסביר יותר מדי, אל תשאל שאלות מיותרות.`,
    `יכולות שלך: לראות לוח (get_schedule), להזיז תור בודד לשעה חדשה (move_appointment), להחליף בין שני תורים (swap_appointments), לבטל (cancel_appointment), לקבוע תור חדש ללקוח (book_for_customer), לשלוח הודעה לכל לקוחות היום (send_to_today_customers), ולחפש לקוח (get_customer_info).`,
    `הבחנה חשובה: "תזיז את X לשעה Y" = move_appointment (תור בודד). "תחליף בין X ל-Y" = swap_appointments (שני תורים). אל תציע החלפה כשמבקשים סתם להזיז.`,
    `לפני הזזה/החלפה/ביטול — קרא ל-get_schedule כדי לאמת על איזה תור מדובר, אשר בקצרה, ובצע מיד את הכלי. אחרי שהבעלים אישר — אל תעצור ואל תדבר, פשוט הפעל את הכלי.`,
    `⚠️ קריטי: כל הכלים שלך (swap_appointments, move_appointment, cancel_appointment, book_for_customer) שולחים ללקוח הודעת WhatsApp אוטומטית בעצמך — אתה כן יכול לפנות ללקוחות. לעולם אל תגיד "אני לא יכול לפנות ללקוח" או "רק אתה יכול לשלוח לו" — זה לא נכון. אתה מבצע את הפעולה והלקוח מקבל הודעה מיד.`,
    `אין לך תהליך "בקשת אישור מהלקוח" וגם אין צורך — לבעלים יש סמכות מלאה. אם הבעלים אומר "תבקש מהלקוח אם הוא מאשר" — הסבר בקצרה שאתה מבצע את ההחלפה ישירות ושני הלקוחות מקבלים הודעה אוטומטית על השינוי, ושאל אם להמשיך. אל תמציא הגבלות ואל תציע לשלוח הודעה לכל לקוחות היום במקום.`,
    `קביעת תור ללקוח: כשנותנים לך שם (גם שם פרטי בלבד) — תמיד קרא קודם ל-get_customer_info עם השם כדי לאתר אותו. אם נמצא לקוח אחד — קבע לו (אל תבקש טלפון, הוא כבר רשום). אם נמצאו כמה עם אותו שם — שאל איזה (לפי שם משפחה/טלפון). רק אם באמת לא נמצא אף אחד — זו לקוחה/לקוח חדש, ואז בקש מספר טלפון.`,
    `לקוח שמופיע בלוח התורים נמצא בהכרח גם במאגר הלקוחות — לעולם אל תאמר "לא קיים במערכת" על מישהו שיש לו תור. אם get_customer_info לא מצא — נסה שם פרטי בלבד, ואל תתבלבל בין "לוח" ל"מאגר".`,
    `לפני הקביעה עצמה קרא ל-get_staff_and_services לקבלת מזהי ספר ושירות. אל תציף את הבעלים בשאלות — חפש בעצמך מה שאתה יכול, ושאל רק מה שחסר באמת.`,
    `אם פקודה דו-משמעית (למשל "תזיז את 13" כשיש כמה תורים ב-13) — הראה את האפשרויות הרלוונטיות בקצרה ובקש הבהרה.`,
    `כל ההודעות בעברית. עכשיו: ${now} (אסיה/ירושלים).`,
  ].join("\n");
}

// ── Public entry point ────────────────────────────────────────────────────────
export async function runOwnerAgent(opts: {
  businessId: string;
  phone: string;
  incomingText: string;
  senderName?: string;
}): Promise<void> {
  const { businessId, phone, incomingText, senderName } = opts;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true },
  });
  const businessName = business?.name || "העסק";

  // Own conversation thread (hidden from the customer inbox via agentType="owner").
  let conv = await prisma.conversation.findFirst({
    where: { businessId, phone, agentType: "owner" },
    orderBy: { createdAt: "desc" },
  });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: {
        businessId, phone, agentType: "owner", status: "active",
        lastMessageAt: new Date(), whatsappName: senderName || null,
      },
    });
  }

  // Persist the incoming command.
  await prisma.conversationMessage.create({
    data: { conversationId: conv.id, role: "user", source: "agent", content: incomingText },
  });
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date() },
  });

  // Load recent history for context.
  const history = await prisma.conversationMessage.findMany({
    where: { conversationId: conv.id, role: { not: "tool" } },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY,
    select: { role: true, content: true },
  });
  const messages: Anthropic.MessageParam[] = history
    .reverse()
    .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  const system = ownerSystemPrompt(firstName(senderName || "הבעלים"), businessName);

  // ── Agentic loop ────────────────────────────────────────────────────────────
  let assistantText = "";
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: MODEL_SMART,
      max_tokens: 1024,
      system,
      tools: OWNER_TOOLS,
      messages,
    });
    const u = response.usage;
    console.log(`[owner-agent] in=${u.input_tokens} out=${u.output_tokens}`);

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        let result: string;
        try {
          result = await execOwnerTool(block.name, block.input as Record<string, unknown>, businessId);
        } catch (e) {
          console.error("[owner-agent] tool error", block.name, e);
          result = `שגיאה בביצוע ${block.name}.`;
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
        await prisma.conversationMessage.create({
          data: {
            conversationId: conv.id, role: "tool", content: result,
            toolName: block.name, toolCallId: block.id,
          },
        });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    for (const block of response.content) {
      if (block.type === "text") assistantText += block.text;
    }
    break;
  }

  if (!assistantText.trim()) assistantText = "בוצע.";

  // Send reply back to the owner (split blank-line-separated bubbles).
  const bubbles = assistantText.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
  for (let i = 0; i < bubbles.length; i++) {
    await prisma.conversationMessage.create({
      data: { conversationId: conv.id, role: "assistant", content: bubbles[i] },
    });
    await sendMessage({ businessId, customerPhone: phone, kind: "agent_reply", body: bubbles[i] });
    if (i < bubbles.length - 1) await new Promise(r => setTimeout(r, 600));
  }
}
