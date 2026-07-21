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
import { SETUP_FIELDS, missingCoreFields, unansweredFields, type SetupConfig } from "@/lib/agent/setup-fields";

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
// Exported so the external agent gateway (/api/agent/gateway) can publish the
// same catalog + reuse the same executor. The WhatsApp owner agent and the CEO
// gateway therefore share one source of truth for what the agent can do.
export const OWNER_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_schedule",
    description:
      "מחזיר את לוח התורים ליום נתון (ברירת מחדל: היום), או לטווח ימים. כולל שם לקוח, שירות, ספר, שעה, ומזהה התור (appointment ID) שצריך לפעולות אחרות. השתמש בזה תמיד לפני החלפה/ביטול כדי לאמת על איזה תור מדובר.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "תאריך התחלה בפורמט YYYY-MM-DD. אם לא צוין — היום." },
        days: { type: "number", description: "כמה ימים להציג מהתאריך והלאה (ברירת מחדל 1; למשל 7 = שבוע). מקסימום 14." },
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
  {
    name: "send_to_customer",
    description:
      "שולח הודעת WhatsApp מיידית ללקוח ספציפי אחד. מזהה את הלקוח לפי שם או טלפון. אם יש כמה לקוחות עם אותו שם — הכלי יחזיר את הרשימה ותצטרך לציין טלפון מדויק. השתמש בזה כשמבקשים 'תשלח ל<שם> הודעה'.",
    input_schema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "שם או טלפון של הלקוח" },
        message: { type: "string", description: "תוכן ההודעה. אפשר {name} לשם הפרטי." },
      },
      required: ["customer", "message"],
    },
  },
  {
    name: "send_to_customers",
    description:
      "שולח הודעת WhatsApp לרשימת לקוחות ספציפיים שתבחר (מערך של שמות ו/או טלפונים). ההודעות נשלחות בהדרגה (כדקה בין הודעה להודעה) כדי לא לחסום את המספר. מחזיר כמה נשלחו ומי לא זוהה. אפשר {name} בתוך ההודעה לשם הפרטי.",
    input_schema: {
      type: "object",
      properties: {
        customers: { type: "array", items: { type: "string" }, description: "שמות או טלפונים של הלקוחות" },
        message: { type: "string", description: "תוכן ההודעה. {name} יוחלף בשם הפרטי." },
      },
      required: ["customers", "message"],
    },
  },
  {
    name: "get_business_stats",
    description:
      "מחזיר סיכום ביצועים לתקופה: מספר תורים, הכנסה משוערת (סכום מחירי התורים שלא בוטלו), ופילוח לפי ספר. period = today | week | month (ברירת מחדל: today). week = 7 הימים האחרונים, month = 30 הימים האחרונים.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", description: "today | week | month" },
      },
    },
  },
  {
    name: "get_customer_history",
    description:
      "מחזיר היסטוריית לקוח: מספר ביקורים שהיו, תאריך ביקור אחרון, סכום כולל ששילם, והתורים הקרובים. חפש לפי שם או טלפון.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "שם או טלפון של הלקוח" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_conversations",
    description:
      "קריאה בלבד: סקירת שיחות וואטסאפ עם לקוחות — מי כתב לאחרונה, כמה הודעות, ומה נאמר. הכי שימושי: status=\"unanswered\" — שיחות שההודעה האחרונה בהן מהלקוח ועברו יותר מ-30 דקות בלי מענה (הלקוחות שנפלו בין הכיסאות). כשמסננים לפי customer יחיד ונמצאת שיחה אחת — מוחזר השרשור המלא כדי להבין למה הסוכן נתקע; אחרת רשימה עם הודעה אחרונה. כלי פיקוח בלבד — לא שולח כלום.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "\"unanswered\" או \"all\" (ברירת מחדל: all)." },
        customer: { type: "string", description: "סינון לפי שם או טלפון של לקוח (אופציונלי)." },
        since: { type: "string", description: "מתאריך YYYY-MM-DD (אופציונלי)." },
        until: { type: "string", description: "עד תאריך YYYY-MM-DD (אופציונלי)." },
        limit: { type: "number", description: "מקסימום שיחות (ברירת מחדל 30, מקסימום 60)." },
      },
    },
  },
  {
    name: "request_appointment_change",
    description:
      "שולח ללקוח בקשה לשנות תור (העברה/ביטול/החלפה) ומחכה לאישורו — לא נוגע בתור עד שהלקוח עונה \"כן\". השתמש בזה כשרוצים לשאול את הלקוח לפני שמשנים, במקום move_appointment/cancel_appointment/swap_appointments שמבצעים מיד. type=move צריך new_time (ואופציונלית new_date). type=swap צריך swap_with_appointment_id. type=cancel אופציונלית reason. הבקשה פגה תוך 24 שעות; בקשה חדשה על אותו תור מבטלת קודמת.",
    input_schema: {
      type: "object",
      properties: {
        appointment_id: { type: "string", description: "מזהה התור שרוצים לשנות" },
        type: { type: "string", description: "move | cancel | swap" },
        new_time: { type: "string", description: "למעבר (move): השעה החדשה HH:MM" },
        new_date: { type: "string", description: "למעבר (move): תאריך חדש YYYY-MM-DD (אופציונלי — ברירת מחדל אותו יום)" },
        swap_with_appointment_id: { type: "string", description: "להחלפה (swap): מזהה התור השני להחלפה" },
        reason: { type: "string", description: "לביטול (cancel): סיבה אופציונלית שתופיע ללקוח" },
      },
      required: ["appointment_id", "type"],
    },
  },
  {
    name: "get_pending_requests",
    description: "מחזיר את בקשות השינוי שממתינות לתשובת לקוח (העברה/ביטול/החלפה) — מה תלוי באוויר ומתי כל אחת פגה.",
    input_schema: { type: "object", properties: {} },
  },
  // ── Setup interview: configure the customer agent by asking the owner ──────
  {
    name: "get_setup_status",
    description:
      "מחזיר את מצב הגדרת הסוכן: אילו שדות כבר מולאו, ומהי השאלה הבאה שיש לשאול את הבעלים (עם הניסוח המדויק, האפשרויות וברירת המחדל). קרא לזה כשהבעלים מבקש להגדיר/לכוונן את הסוכן, או כדי לדעת מה עוד חסר. אל תמציא שאלות — קח אותן מכאן.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "save_setup_field",
    description:
      "שומר תשובה אחת של הבעלים לשדה הגדרה. קרא לזה אחרי כל תשובה. key חייב להיות מזהה שדה שחזר מ-get_setup_status; value היא התשובה של הבעלים (לשדה בחירה — אחת האפשרויות; לשדה כן/לא — 'כן' או 'לא'). מחזיר אישור והתקדמות.",
    input_schema: {
      type: "object",
      properties: {
        key:   { type: "string", description: "מזהה השדה (מ-get_setup_status)" },
        value: { type: "string", description: "התשובה של הבעלים" },
      },
      required: ["key", "value"],
    },
  },
];

// ── Tool executor ───────────────────────────────────────────────────────────
// Exported for the agent gateway. `staffId` scopes to a personal calendar; pass
// null for full business-wide access (the CEO gateway does this).
export async function execOwnerTool(
  name: string,
  input: Record<string, unknown>,
  businessId: string,
  staffId: string | null
): Promise<string> {
  switch (name) {
    // ── Schedule for a day ──────────────────────────────────────────────────
    case "get_schedule": {
      const startIso = (input.date as string) || getBusinessNow().date;
      const days = Math.max(1, Math.min(14, Math.round(Number(input.days) || 1)));
      const rangeStart = new Date(`${startIso}T00:00:00.000Z`);
      const rangeEnd = new Date(rangeStart);
      rangeEnd.setUTCDate(rangeEnd.getUTCDate() + days); // exclusive end
      const appts = await prisma.appointment.findMany({
        where: {
          businessId,
          ...(staffId ? { staffId } : {}),
          date: { gte: rangeStart, lt: rangeEnd },
          status: { in: ACTIVE_STATUSES },
        },
        include: {
          customer: { select: { name: true, phone: true } },
          staff: { select: { name: true } },
          service: { select: { name: true } },
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      });
      if (!appts.length) {
        return days === 1
          ? `אין תורים פעילים ב-${hebDayLabel(startIso)} (${startIso}).`
          : `אין תורים פעילים ב-${days} הימים החל מ-${startIso}.`;
      }
      if (days === 1) {
        const lines = appts.map(
          a => `${a.startTime}–${a.endTime} | ${a.customer.name} | ${a.service.name} | ${a.staff.name} | id=${a.id}`
        );
        return `לוח ${hebDayLabel(startIso)} (${startIso}) — ${appts.length} תורים:\n${lines.join("\n")}`;
      }
      // Multi-day: group by date.
      const byDay = new Map<string, string[]>();
      for (const a of appts) {
        const d = new Date(a.date).toISOString().slice(0, 10);
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d)!.push(`  ${a.startTime}–${a.endTime} | ${a.customer.name} | ${a.service.name} | ${a.staff.name} | id=${a.id}`);
      }
      const sections = Array.from(byDay.entries()).map(
        ([d, lines]) => `${hebDayLabel(d)} (${d}) — ${lines.length}:\n${lines.join("\n")}`
      );
      return `לוח ${days} ימים מ-${startIso} — ${appts.length} תורים:\n\n${sections.join("\n\n")}`;
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
      if (staffId && (a1.staffId !== staffId || a2.staffId !== staffId)) {
        return "שגיאה: אחד התורים אינו ביומן האישי שלך. אתה יכול להחליף רק בין תורים שלך.";
      }
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
          where: { businessId, isActive: true, ...(staffId ? { id: staffId } : {}) },
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
      if (staffId && appt.staffId !== staffId) return "שגיאה: התור אינו ביומן האישי שלך — אפשר להזיז רק תורים שלך.";
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
      // When scoped to a personal calendar, always book on the owner's own staffId.
      const reqStaffId = (input.staff_id as string) || "";
      const effStaffId = staffId || reqStaffId;
      const serviceId = input.service_id as string;
      const date = input.date as string;
      const time = input.time as string;
      const customerName = ((input.customer_name as string) || "").trim();
      const rawPhone = ((input.customer_phone as string) || "").trim();
      const force = input.force === true;
      if (!customerName) return "שגיאה: חסר שם לקוח.";
      if (!effStaffId) return "שגיאה: חסר מזהה ספר. קרא ל-get_staff_and_services לקבלת מזהים.";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return "שגיאה: תאריך לא תקין (YYYY-MM-DD).";
      if (!/^\d{1,2}:\d{2}$/.test(time || "")) return "שגיאה: שעה לא תקינה (HH:MM).";

      const [staff, service] = await Promise.all([
        prisma.staff.findFirst({ where: { id: effStaffId, businessId }, select: { id: true, name: true } }),
        prisma.service.findUnique({ where: { id: serviceId }, select: { id: true, name: true, price: true, durationMinutes: true } }),
      ]);
      if (!staff) return "שגיאה: ספר לא נמצא. קרא ל-get_staff_and_services לקבלת מזהים.";
      if (!service) return "שגיאה: שירות לא נמצא. קרא ל-get_staff_and_services לקבלת מזהים.";

      // Availability guard (owner may override with force).
      if (!force) {
        const dayAvail = await computeDayAvailability(businessId, date, effStaffId, serviceId);
        const slots = dayAvail.find(s => s.staffId === effStaffId)?.slots ?? [];
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
          where: { businessId, name: { contains: customerName, mode: "insensitive" }, deletedAt: null },
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

      const eff = await resolveStaffService(effStaffId, serviceId, service.name, service.durationMinutes, service.price);
      const apptDate = new Date(`${date}T00:00:00.000Z`);
      const endTime = minutesToTime(timeToMinutes(time) + eff.duration);

      let appt;
      try {
        appt = await prisma.appointment.create({
          data: {
            businessId, customerId: customer.id, staffId: effStaffId, serviceId,
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
      if (staffId && appt.staffId !== staffId) return "שגיאה: התור אינו ביומן האישי שלך — אפשר לבטל רק תורים שלך.";
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
          ...(staffId ? { staffId } : {}),
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
          kind: "agent_broadcast",
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
          deletedAt: null,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            ...(digits ? [{ phone: { contains: digits } }] : []),
          ],
        },
        take: 8,
        select: {
          id: true, name: true, phone: true,
          appointments: {
            where: {
              date: { gte: new Date(`${getBusinessNow().date}T00:00:00.000Z`) },
              status: { in: ACTIVE_STATUSES },
              ...(staffId ? { staffId } : {}),
            },
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

    // ── Send a WhatsApp to ONE specific customer ────────────────────────────
    case "send_to_customer": {
      const query = String(input.customer || "").trim();
      const message = String(input.message || "").trim();
      if (!query) return "שגיאה: לא צוין לקוח.";
      if (!message) return "שגיאה: ההודעה ריקה.";
      const digits = query.replace(/\D/g, "");
      const matches = await prisma.customer.findMany({
        where: { businessId, OR: [
          { name: { contains: query, mode: "insensitive" } },
          ...(digits ? [{ phone: { contains: digits } }] : []),
        ] },
        select: { id: true, name: true, phone: true },
        take: 8,
      });
      const withPhone = matches.filter(m => m.phone);
      if (!withPhone.length) return `לא נמצא לקוח עם טלפון התואם ל-"${query}".`;
      if (withPhone.length > 1) {
        const list = withPhone.map(m => `${m.name} (${m.phone})`).join(", ");
        return `יש כמה לקוחות שמתאימים ל-"${query}": ${list}. ציין טלפון מדויק כדי שאדע למי לשלוח.`;
      }
      const c = withPhone[0];
      const res = await sendMessage({
        businessId, customerPhone: c.phone as string, kind: "agent_broadcast",
        body: message.replace(/\{name\}/g, firstName(c.name)),
      });
      return res.ok ? `נשלח ל${c.name} (${c.phone}).` : `שליחה ל${c.name} נכשלה.`;
    }

    // ── Send a WhatsApp to a chosen LIST of customers (ban-safe drip) ────────
    case "send_to_customers": {
      const rawList = Array.isArray(input.customers)
        ? (input.customers as unknown[]).map(x => String(x).trim()).filter(Boolean)
        : [];
      const message = String(input.message || "").trim();
      if (!rawList.length) return "שגיאה: לא צוינה רשימת לקוחות.";
      if (!message) return "שגיאה: ההודעה ריקה.";
      const resolved = new Map<string, string>(); // phone -> name
      const problems: string[] = [];
      for (const entry of rawList) {
        const d = entry.replace(/\D/g, "");
        const m = await prisma.customer.findMany({
          where: { businessId, OR: [
            { name: { contains: entry, mode: "insensitive" } },
            ...(d ? [{ phone: { contains: d } }] : []),
          ] },
          select: { name: true, phone: true },
          take: 5,
        });
        const wp = m.filter(x => x.phone);
        if (!wp.length) { problems.push(`${entry} — לא נמצא`); continue; }
        if (wp.length > 1) { problems.push(`${entry} — כמה התאמות`); continue; }
        resolved.set(wp[0].phone as string, wp[0].name);
      }
      if (resolved.size === 0) return `לא זוהה אף לקוח. ${problems.join("; ")}`;
      const INTERVAL_SEC = 60;
      const now = Date.now();
      const rows = Array.from(resolved.entries()).map(([phone, name], i) => ({
        businessId,
        customerPhone: phone,
        kind: "agent_broadcast",
        body: message.replace(/\{name\}/g, firstName(name)),
        status: "scheduled",
        scheduledFor: new Date(now + i * INTERVAL_SEC * 1000 + Math.floor((Math.random() * 20 - 10) * 1000)),
      }));
      await prisma.messageLog.createMany({ data: rows });
      const etaMin = Math.ceil((resolved.size * INTERVAL_SEC) / 60);
      let out = `ההודעה תישלח ל-${resolved.size} לקוחות (כ-${etaMin} דק').`;
      if (problems.length) out += ` לא נשלחו: ${problems.join("; ")}.`;
      return out;
    }

    // ── Business performance summary ────────────────────────────────────────
    case "get_business_stats": {
      const period = String(input.period || "today").toLowerCase();
      const todayIso = getBusinessNow().date;
      const end = new Date(`${todayIso}T23:59:59.999Z`);
      let startIso = todayIso;
      if (period === "week" || period === "month") {
        const d = new Date(`${todayIso}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() - (period === "week" ? 6 : 29));
        startIso = d.toISOString().slice(0, 10);
      }
      const start = new Date(`${startIso}T00:00:00.000Z`);
      const appts = await prisma.appointment.findMany({
        where: {
          businessId, ...(staffId ? { staffId } : {}),
          date: { gte: start, lte: end },
          status: { notIn: ["cancelled_by_customer", "cancelled_by_staff", "no_show"] },
        },
        include: { staff: { select: { name: true } } },
      });
      const revenue = appts.reduce((s, a) => s + (a.price ?? 0), 0);
      const label = period === "week" ? "7 הימים האחרונים"
        : period === "month" ? "30 הימים האחרונים"
        : `היום (${todayIso})`;
      if (staffId) return `סיכום ${label}: ${appts.length} תורים, הכנסה משוערת ${revenue}₪.`;
      const byStaff = new Map<string, { count: number; rev: number }>();
      for (const a of appts) {
        const k = a.staff?.name || "—";
        const cur = byStaff.get(k) || { count: 0, rev: 0 };
        cur.count++; cur.rev += a.price ?? 0;
        byStaff.set(k, cur);
      }
      const staffLines = Array.from(byStaff.entries())
        .sort((x, y) => y[1].rev - x[1].rev)
        .map(([n, v]) => `  ${n}: ${v.count} תורים, ${v.rev}₪`).join("\n");
      return `סיכום ${label}: ${appts.length} תורים, הכנסה משוערת ${revenue}₪.\nלפי ספר:\n${staffLines}`;
    }

    // ── Customer visit history ──────────────────────────────────────────────
    case "get_customer_history": {
      const q = String(input.query || "").trim();
      if (!q) return "שגיאה: חיפוש ריק.";
      const digits = q.replace(/\D/g, "");
      const matches = await prisma.customer.findMany({
        where: { businessId, OR: [
          { name: { contains: q, mode: "insensitive" } },
          ...(digits ? [{ phone: { contains: digits } }] : []),
        ] },
        select: { id: true, name: true, phone: true },
        take: 5,
      });
      if (!matches.length) return `לא נמצא לקוח התואם ל-"${q}".`;
      if (matches.length > 1) {
        return `יש כמה לקוחות: ${matches.map(m => `${m.name} (${m.phone ?? "ללא טלפון"})`).join(", ")}. ציין מדויק יותר.`;
      }
      const c = matches[0];
      const nowMid = new Date(`${getBusinessNow().date}T00:00:00.000Z`);
      const scope = staffId ? { staffId } : {};
      const [past, upcoming] = await Promise.all([
        prisma.appointment.findMany({
          where: { businessId, customerId: c.id, ...scope, date: { lt: nowMid },
            status: { notIn: ["cancelled_by_customer", "cancelled_by_staff", "no_show"] } },
          orderBy: { date: "desc" },
          select: { date: true, price: true },
        }),
        prisma.appointment.findMany({
          where: { businessId, customerId: c.id, ...scope, date: { gte: nowMid }, status: { in: ACTIVE_STATUSES } },
          orderBy: { date: "asc" }, take: 5,
          include: { staff: { select: { name: true } }, service: { select: { name: true } } },
        }),
      ]);
      const visits = past.length;
      const spent = past.reduce((s, a) => s + (a.price ?? 0), 0);
      const last = visits ? new Date(past[0].date).toISOString().slice(0, 10) : "—";
      const up = upcoming.length
        ? upcoming.map(a => `  • ${new Date(a.date).toISOString().slice(0, 10)} ${a.startTime} ${a.service.name} (${a.staff.name}) id=${a.id}`).join("\n")
        : "  אין תורים עתידיים";
      return `${c.name} | ${c.phone ?? "ללא טלפון"}\nביקורים: ${visits}, אחרון: ${last}, סה"כ שילם: ${spent}₪\nתורים קרובים:\n${up}`;
    }

    // ── Oversight: list customer conversations (read-only) ──────────────────
    case "get_conversations": {
      const status = String(input.status || "all").toLowerCase();
      const limit = Math.max(1, Math.min(60, Math.round(Number(input.limit) || 30)));
      const customer = String(input.customer || "").trim();
      const custDigits = customer.replace(/\D/g, "");

      // For "unanswered" we must inspect the last message per conversation, so pull
      // a wider recent window then filter; for "all" the DB limit is exact.
      const fetchCount = status === "unanswered" ? 200 : limit;
      const convs = await prisma.conversation.findMany({
        where: {
          businessId,
          agentType: { not: "owner" },
          ...(customer ? {
            OR: [
              { whatsappName: { contains: customer, mode: "insensitive" } },
              { customer: { name: { contains: customer, mode: "insensitive" } } },
              ...(custDigits ? [{ phone: { contains: custDigits } }] : []),
            ],
          } : {}),
          ...((input.since || input.until) ? {
            lastMessageAt: {
              ...(input.since ? { gte: new Date(`${input.since as string}T00:00:00.000Z`) } : {}),
              ...(input.until ? { lte: new Date(`${input.until as string}T23:59:59.999Z`) } : {}),
            },
          } : {}),
        },
        orderBy: { lastMessageAt: "desc" },
        take: fetchCount,
        select: {
          id: true, phone: true, whatsappName: true, status: true,
          createdAt: true, lastMessageAt: true,
          customer: { select: { name: true } },
          _count: { select: { messages: true } },
          messages: {
            orderBy: { createdAt: "desc" }, take: 1,
            select: { role: true, source: true, content: true, createdAt: true },
          },
        },
      });

      const now = Date.now();
      const CUTOFF_MS = 30 * 60 * 1000;
      const ago = (d: Date) => {
        const m = Math.round((now - new Date(d).getTime()) / 60000);
        if (m < 60) return `לפני ${m} דק'`;
        const h = Math.round(m / 60);
        return h < 24 ? `לפני ${h} שע'` : `לפני ${Math.round(h / 24)} ימים`;
      };
      const whoSent = (msg: { role: string; source: string }) =>
        msg.role === "user" ? "לקוח" : msg.source === "admin" ? "אדמין" : "סוכן";

      let rows = convs.map(c => {
        const last = c.messages[0];
        const waitingMs = last && last.role === "user" ? now - new Date(last.createdAt).getTime() : 0;
        const unanswered = !!last && last.role === "user" && waitingMs > CUTOFF_MS;
        return { c, last, unanswered, waitingMs };
      });

      if (status === "unanswered") {
        rows = rows.filter(r => r.unanswered).sort((a, b) => b.waitingMs - a.waitingMs);
      }
      rows = rows.slice(0, limit);

      if (!rows.length) {
        return status === "unanswered"
          ? "אין שיחות ללא מענה כרגע — כל מי שכתב קיבל תשובה."
          : "לא נמצאו שיחות התואמות.";
      }

      // Drill-in: a customer filter that narrows to ONE conversation returns the
      // FULL thread (so the owner can see WHY the agent got stuck), not an excerpt.
      if (customer && rows.length === 1) {
        const conv = rows[0].c;
        const msgs = await prisma.conversationMessage.findMany({
          where: { conversationId: conv.id },
          orderBy: { createdAt: "desc" },
          take: 60,
          select: { role: true, source: true, content: true, createdAt: true },
        });
        msgs.reverse(); // chronological
        const name = conv.customer?.name || conv.whatsappName || conv.phone;
        const when = (d: Date) =>
          new Date(d).toLocaleString("he-IL", {
            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
            hour12: false, timeZone: "Asia/Jerusalem",
          });
        const body = msgs
          .map(m => `${when(m.createdAt)} ${whoSent(m)}: ${m.content.replace(/\s+/g, " ").trim()}`)
          .join("\n");
        return `שיחה עם ${name} | ${conv.phone} | סטטוס: ${conv.status} | ${conv._count.messages} הודעות:\n${body}`;
      }

      const lines = rows.map(({ c, last, unanswered }) => {
        const name = c.customer?.name || c.whatsappName || c.phone;
        const excerpt = last ? last.content.replace(/\s+/g, " ").slice(0, 200) : "אין הודעות";
        const lastInfo = last ? `אחרון: ${whoSent(last)} ${ago(last.createdAt)}` : "ריק";
        const flag = unanswered ? "⚠️ ללא מענה · " : "";
        return `${flag}${name} | ${c.phone} | ${c._count.messages} הודעות | ${lastInfo} | "${excerpt}"`;
      });
      const header = status === "unanswered"
        ? `${rows.length} שיחות ללא מענה (>30 דק'), מהממתין הכי הרבה:`
        : `${rows.length} שיחות (מהעדכני):`;
      return `${header}\n${lines.join("\n")}`;
    }

    // ── Ask the customer before changing (pending request, awaits yes/no) ────
    case "request_appointment_change": {
      const apptId = input.appointment_id as string;
      const type = String(input.type || "").toLowerCase();
      if (!["move", "cancel", "swap"].includes(type)) return "שגיאה: type חייב להיות move / cancel / swap.";
      const appt = await prisma.appointment.findUnique({
        where: { id: apptId },
        include: { customer: true, staff: true, service: true },
      });
      if (!appt || appt.businessId !== businessId) return `שגיאה: תור ${apptId} לא נמצא בעסק.`;
      if (staffId && appt.staffId !== staffId) return "שגיאה: התור אינו ביומן האישי שלך.";
      if (!ACTIVE_STATUSES.includes(appt.status)) return "התור כבר אינו פעיל (מבוטל/הושלם).";
      const curDateIso = new Date(appt.date).toISOString().slice(0, 10);

      // Type-specific fields for the proposal + the customer-facing message.
      let targetStaffId: string | undefined;
      let targetDate: Date | undefined;
      let targetStartTime: string | undefined;
      let candidateAppointmentId: string | undefined;
      let customerPhone: string | null = appt.customer.phone;
      let msgKind: "move_proposal" | "cancel_proposal" | "swap_proposal";
      let body: string;

      if (type === "move") {
        const newTime = input.new_time as string;
        if (!/^\d{1,2}:\d{2}$/.test(newTime || "")) return "שגיאה: לסוג move צריך new_time תקין (HH:MM).";
        const newDateIso = (input.new_date as string) || curDateIso;
        const dayAvail = await computeDayAvailability(businessId, newDateIso, appt.staffId, appt.serviceId);
        const slots = dayAvail.find(s => s.staffId === appt.staffId)?.slots ?? [];
        if (!slots.includes(newTime)) {
          return `שים לב: ${newTime} ב-${newDateIso} לא פנוי אצל ${appt.staff.name}. בחר שעה פנויה (get_schedule כדי לראות מה תפוס).`;
        }
        targetStaffId = appt.staffId;
        targetDate = new Date(`${newDateIso}T00:00:00.000Z`);
        targetStartTime = newTime;
        msgKind = "move_proposal";
        body = `היי ${firstName(appt.customer.name)}, רצינו לבדוק — אפשר להעביר את התור שלך ב-DOMINANT ל-${hebDayLabel(newDateIso)} בשעה ${newTime}? עני/ה כן או לא 🙏`;
      } else if (type === "cancel") {
        const reason = ((input.reason as string) || "").trim();
        msgKind = "cancel_proposal";
        body = `היי ${firstName(appt.customer.name)}, לגבי התור שלך ב-DOMINANT ל-${hebDayLabel(curDateIso)} בשעה ${appt.startTime}${reason ? ` — ${reason}` : ""}. צריך לבטל אותו — בסדר מצידך? כן/לא 🙏`;
      } else {
        const candId = (input.swap_with_appointment_id as string) || "";
        if (!candId) return "שגיאה: לסוג swap צריך swap_with_appointment_id.";
        if (candId === appt.id) return "שגיאה: אי אפשר להחליף תור עם עצמו.";
        const cand = await prisma.appointment.findUnique({ where: { id: candId }, include: { customer: true } });
        if (!cand || cand.businessId !== businessId) return `שגיאה: תור ${candId} לא נמצא בעסק.`;
        if (!ACTIVE_STATUSES.includes(cand.status)) return "תור ההחלפה כבר אינו פעיל.";
        if (!cand.customer.phone) return "שגיאה: ללקוח של תור ההחלפה אין טלפון.";
        candidateAppointmentId = cand.id;
        customerPhone = cand.customer.phone; // the CANDIDATE is the one asked
        msgKind = "swap_proposal";
        body = `היי ${firstName(cand.customer.name)}, אפשר להעביר את שעת התור שלך ב-DOMINANT מ-${cand.startTime} ל-${appt.startTime}? כן/לא 🙏`;
      }

      if (!customerPhone) return "שגיאה: ללקוח אין מספר טלפון לשליחת הבקשה.";

      // One open request per appointment — supersede any live prior request.
      await prisma.swapProposal.updateMany({
        where: {
          primaryAppointmentId: appt.id,
          status: { in: ["pending_response", "pending_staff_approval", "queued_next", "accepted_by_customer"] },
        },
        data: { status: "superseded" },
      });

      const proposal = await prisma.swapProposal.create({
        data: {
          businessId,
          primaryAppointmentId: appt.id,
          initiatedBy: "admin",
          kind: type,
          status: "pending_response",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          targetStaffId, targetDate, targetStartTime, candidateAppointmentId,
        },
      });
      const res = await sendMessage({ businessId, customerPhone, kind: msgKind, body });
      const label = type === "move" ? "העברה" : type === "cancel" ? "ביטול" : "החלפה";
      return `נשלחה בקשת ${label} ללקוח. ${res.ok ? "ההודעה יצאה" : "אך שליחת ההודעה נכשלה"}. התור לא השתנה — ממתין לתשובת הלקוח (פג תוך 24 שעות). כשהלקוח יענה "כן", זה יתבצע אוטומטית. id=${proposal.id}`;
    }

    // ── What's awaiting a customer's yes/no ─────────────────────────────────
    case "get_pending_requests": {
      const props = await prisma.swapProposal.findMany({
        where: {
          businessId,
          status: { in: ["pending_response", "pending_staff_approval", "queued_next"] },
          ...(staffId ? { primary: { staffId } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: {
          primary:   { include: { customer: { select: { name: true } } } },
          candidate: { include: { customer: { select: { name: true } } } },
        },
      });
      if (!props.length) return "אין בקשות שינוי פתוחות כרגע.";
      const lines = props.map(pr => {
        const label = pr.kind === "move" ? "העברה" : pr.kind === "cancel" ? "ביטול" : "החלפה";
        const pName = pr.primary?.customer.name ?? "—";
        const pDate = pr.primary ? new Date(pr.primary.date).toISOString().slice(0, 10) : "";
        let detail = "";
        if (pr.kind === "move" && pr.targetStartTime) {
          const td = pr.targetDate ? new Date(pr.targetDate).toISOString().slice(0, 10) : pDate;
          detail = `→ ${td} ${pr.targetStartTime}`;
        } else if (pr.kind === "swap" && pr.candidate) {
          detail = `↔ ${pr.candidate.customer.name}`;
        }
        const mins = Math.max(0, Math.round((new Date(pr.expiresAt).getTime() - Date.now()) / 60000));
        const expires = mins < 60 ? `${mins} דק'` : `${Math.round(mins / 60)} שע'`;
        return `${label} | ${pName} (${pDate} ${pr.primary?.startTime ?? ""}) ${detail} | פג בעוד ${expires} | id=${pr.id}`;
      });
      return `${props.length} בקשות פתוחות (ממתינות לתשובת לקוח):\n${lines.join("\n")}`;
    }

    // ── Setup interview: current status + the next question to ask ───────────
    case "get_setup_status": {
      const cfg = await prisma.agentConfig.findUnique({ where: { businessId }, select: { setupConfig: true } });
      let setup: SetupConfig = {};
      if (cfg?.setupConfig) { try { setup = JSON.parse(cfg.setupConfig) as SetupConfig; } catch { setup = {}; } }
      const answered = SETUP_FIELDS.filter(f => setup[f.key] !== undefined && setup[f.key] !== "");
      const missing = missingCoreFields(setup);
      const pending = unansweredFields(setup);
      const coreTotal = SETUP_FIELDS.filter(f => f.core).length;
      if (!pending.length) {
        return `כל שדות ההגדרה מולאו (${answered.length}/${SETUP_FIELDS.length}). הסוכן מוגדר. אם הבעלים רוצה לשנות משהו — שאל מה, וקרא ל-save_setup_field עם השדה המתאים.`;
      }
      const next = pending[0];
      const opts = next.options ? ` אפשרויות: ${next.options.join(" / ")}.` : "";
      const def = next.default !== undefined ? ` ברירת מחדל: ${next.default === true ? "כן" : next.default === false ? "לא" : next.default}.` : "";
      const readyLine = missing.length
        ? `עוד ${missing.length} שדות ליבה עד שהסוכן מוכן לאוויר.`
        : `כל שדות הליבה מולאו — הסוכן מוכן לאוויר; השאר לליטוש.`;
      return [
        `התקדמות: ${coreTotal - missing.length}/${coreTotal} שדות ליבה, ${answered.length}/${SETUP_FIELDS.length} סה"כ. ${readyLine}`,
        `השאלה הבאה (key=${next.key}): "${next.question}".${opts}${def}`,
        `שאל את הבעלים את השאלה במילים שלך; אחרי שהוא עונה קרא ל-save_setup_field עם key="${next.key}". שאלה אחת בכל פעם.`,
      ].join("\n");
    }

    // ── Setup interview: persist one answer ─────────────────────────────────
    case "save_setup_field": {
      const key = String(input.key || "").trim();
      const rawVal = String(input.value ?? "").trim();
      const field = SETUP_FIELDS.find(f => f.key === key);
      if (!field) return `שגיאה: שדה לא מוכר (${key}). קרא ל-get_setup_status לקבלת מזהי השדות.`;
      if (!rawVal) return `שגיאה: לא התקבלה תשובה לשדה ${key}.`;
      let value: string | boolean = rawVal;
      if (field.type === "bool") {
        if (/^(כן|yes|true|נכון)$/i.test(rawVal)) value = true;
        else if (/^(לא|no|false)$/i.test(rawVal)) value = false;
        else return `שגיאה: לשדה ${key} ענה 'כן' או 'לא' (התקבל: ${rawVal}).`;
      } else if (field.type === "choice" && field.options) {
        const match = field.options.find(o => o === rawVal || rawVal.includes(o) || o.includes(rawVal));
        if (!match) return `שגיאה: לשדה ${key} בחר אחת מ: ${field.options.join(" / ")} (התקבל: ${rawVal}).`;
        value = match;
      }
      const cfg = await prisma.agentConfig.findUnique({ where: { businessId }, select: { setupConfig: true } });
      let setup: SetupConfig = {};
      if (cfg?.setupConfig) { try { setup = JSON.parse(cfg.setupConfig) as SetupConfig; } catch { setup = {}; } }
      setup[key] = value;
      await prisma.agentConfig.upsert({
        where: { businessId },
        create: { businessId, setupConfig: JSON.stringify(setup) },
        update: { setupConfig: JSON.stringify(setup) },
      });
      const missing = missingCoreFields(setup);
      const pending = unansweredFields(setup);
      const progress = missing.length
        ? `נשארו ${missing.length} שדות ליבה.`
        : pending.length ? `כל שדות הליבה מולאו — הסוכן מוכן לאוויר. עוד ${pending.length} שאלות רשות לליטוש.` : `כל השדות מולאו! ההגדרה הושלמה.`;
      const shown = value === true ? "כן" : value === false ? "לא" : value;
      return `נשמר ✅ (${field.group}: ${shown}). ${progress} קרא ל-get_setup_status לשאלה הבאה.`;
    }

    default:
      return `שגיאה: כלי לא מוכר (${name}).`;
  }
}

// ── System prompt (hardcoded — not from DB) ───────────────────────────────────
function ownerSystemPrompt(
  ownerName: string,
  businessName: string,
  scopedStaffName: string | null,
): string {
  const now = new Date().toLocaleString("he-IL", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jerusalem",
  });
  const scopeLine = scopedStaffName
    ? `אתה מנהל אך ורק את היומן האישי של ${scopedStaffName} — התורים שלו כספר בלבד. get_schedule מראה רק את התורים שלו, וכל פעולה (הזזה/החלפה/ביטול/קביעה) מתבצעת רק בתוך היומן שלו. אל תתייחס לתורים של ספרים אחרים, ואל תזכיר אותם. כשקובעים תור — הוא תמיד אצל ${scopedStaffName}.`
    : `יש לך גישה ליומן של כל הספרים בעסק.`;
  return [
    `אתה העוזר האישי של ${ownerName}, ב${businessName}.`,
    scopeLine,
    `אתה מקבל ממנו פקודות ישירות בוואטסאפ ומבצע אותן. יש לך סמכות מלאה — אין צורך באישור לקוח.`,
    `ענה קצר וענייני: פעולה + אישור. אל תסביר יותר מדי, אל תשאל שאלות מיותרות.`,
    `יכולות שלך: לראות לוח (get_schedule), להזיז תור בודד לשעה חדשה (move_appointment), להחליף בין שני תורים (swap_appointments), לבטל (cancel_appointment), לקבוע תור חדש ללקוח (book_for_customer), לשלוח הודעה לכל לקוחות היום (send_to_today_customers), ולחפש לקוח (get_customer_info).`,
    `הבחנה חשובה: "תזיז את X לשעה Y" = move_appointment (תור בודד). "תחליף בין X ל-Y" = swap_appointments (שני תורים). אל תציע החלפה כשמבקשים סתם להזיז.`,
    `לבצע מיד מול לשאול קודם: move_appointment/cancel_appointment/swap_appointments מבצעים את השינוי מיד ומודיעים ללקוח. אם הבעלים מבקש לשאול את הלקוח קודם ("תשאל את X אם מתאים לו", "תבדוק אם אפשר להזיז") — השתמש ב-request_appointment_change: הוא שולח ללקוח בקשה ולא נוגע בתור עד שהלקוח עונה "כן" (ואז זה מתבצע אוטומטית). get_pending_requests מראה מה עדיין ממתין לתשובה.`,
    `לפני הזזה/החלפה/ביטול — קרא ל-get_schedule כדי לאמת על איזה תור מדובר, אשר בקצרה, ובצע מיד את הכלי. אחרי שהבעלים אישר — אל תעצור ואל תדבר, פשוט הפעל את הכלי.`,
    `⚠️ קריטי: כל הכלים שלך (swap_appointments, move_appointment, cancel_appointment, book_for_customer) שולחים ללקוח הודעת WhatsApp אוטומטית בעצמך — אתה כן יכול לפנות ללקוחות. לעולם אל תגיד "אני לא יכול לפנות ללקוח" או "רק אתה יכול לשלוח לו" — זה לא נכון. אתה מבצע את הפעולה והלקוח מקבל הודעה מיד.`,
    `אין לך תהליך "בקשת אישור מהלקוח" וגם אין צורך — לבעלים יש סמכות מלאה. אם הבעלים אומר "תבקש מהלקוח אם הוא מאשר" — הסבר בקצרה שאתה מבצע את ההחלפה ישירות ושני הלקוחות מקבלים הודעה אוטומטית על השינוי, ושאל אם להמשיך. אל תמציא הגבלות ואל תציע לשלוח הודעה לכל לקוחות היום במקום.`,
    `קביעת תור ללקוח: כשנותנים לך שם (גם שם פרטי בלבד) — תמיד קרא קודם ל-get_customer_info עם השם כדי לאתר אותו. אם נמצא לקוח אחד — קבע לו (אל תבקש טלפון, הוא כבר רשום). אם נמצאו כמה עם אותו שם — שאל איזה (לפי שם משפחה/טלפון). רק אם באמת לא נמצא אף אחד — זו לקוחה/לקוח חדש, ואז בקש מספר טלפון.`,
    `לקוח שמופיע בלוח התורים נמצא בהכרח גם במאגר הלקוחות — לעולם אל תאמר "לא קיים במערכת" על מישהו שיש לו תור. אם get_customer_info לא מצא — נסה שם פרטי בלבד, ואל תתבלבל בין "לוח" ל"מאגר".`,
    `לפני הקביעה עצמה קרא ל-get_staff_and_services לקבלת מזהי ספר ושירות. אל תציף את הבעלים בשאלות — חפש בעצמך מה שאתה יכול, ושאל רק מה שחסר באמת.`,
    `אם פקודה דו-משמעית (למשל "תזיז את 13" כשיש כמה תורים ב-13) — הראה את האפשרויות הרלוונטיות בקצרה ובקש הבהרה.`,
    `הגדרת/אימון הסוכן: כשהבעלים מבקש "בוא נגדיר את הסוכן", "להגדיר", "לכוונן", או שואל מה עוד חסר — קרא ל-get_setup_status כדי לקבל את השאלה הבאה, שאל אותה שאלה אחת בכל פעם, ואחרי כל תשובה קרא ל-save_setup_field עם ה-key שחזר. אל תמציא שאלות — הן מגיעות מ-get_setup_status. הובל עם ברירת המחדל ("ברירת מחדל: X — מתאים?") כדי שיהיה מהיר. כששדות הליבה מולאו — עדכן שהסוכן מוכן לאוויר.`,
    `כל ההודעות בעברית. עכשיו: ${now} (אסיה/ירושלים).`,
  ].join("\n");
}

// ── Public entry point ────────────────────────────────────────────────────────
export async function runOwnerAgent(opts: {
  businessId: string;
  phone: string;
  incomingText: string;
  senderName?: string;
  /** When set, the agent is scoped to this staff member's personal calendar only. */
  staffId?: string | null;
}): Promise<void> {
  const { businessId, phone, incomingText, senderName, staffId = null } = opts;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true },
  });
  const businessName = business?.name || "העסק";

  // Resolve the scoped staff's display name (for the prompt), if scoped.
  let scopedStaffName: string | null = null;
  if (staffId) {
    const s = await prisma.staff.findUnique({ where: { id: staffId }, select: { name: true } });
    scopedStaffName = s?.name || null;
  }

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

  const system = ownerSystemPrompt(
    firstName(senderName || scopedStaffName || "הבעלים"),
    businessName,
    scopedStaffName,
  );

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
          result = await execOwnerTool(block.name, block.input as Record<string, unknown>, businessId, staffId);
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
