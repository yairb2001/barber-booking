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
import { computeDayAvailability, computeParallelSlots, resolveStaffService } from "@/lib/agent/availability";
import { requestAppointmentMove } from "@/lib/agent/appointment-swap";
import { getBusinessNow } from "@/lib/utils";

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

// Mid-loop escalation: only write operations need Sonnet mid-turn.
// Availability reads are excluded — Haiku handles "here are the slots" fine
// and there's no point burning Sonnet just to format a list.
const SMART_TOOLS = new Set(["book_appointment", "cancel_appointment", "request_appointment_move", "join_waitlist", "escalate_to_human"]);

// Cross-turn context: if ANY of these ran in recent turns, the conversation is
// in an active booking flow and the NEXT turn needs Sonnet. Availability tools
// are included here because a follow-up turn (e.g. "can I switch to a different
// barber?") requires Sonnet-level reasoning even though slot-listing itself doesn't.
const BOOKING_CONTEXT_TOOLS = new Set([...Array.from(SMART_TOOLS), "get_available_slots", "find_next_available", "find_parallel_slots"]);

function pickInitialModel(
  incomingText: string,
  recentToolNames: (string | null)[]
): string {
  if (SMART_INTENT.test(incomingText)) return MODEL_SMART;
  if (recentToolNames.some(t => t && BOOKING_CONTEXT_TOOLS.has(t))) return MODEL_SMART;
  return MODEL_FAST;
}

// ─── Tool definitions ──────────────────────────────────────────────────────────

const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_services",
    description: "מחזיר רשימת השירותים הזמינים עם מחיר ומשך בדקות. אם מועבר staffId — מחזיר את השמות, המחירים, המשך וההערות המותאמים של אותו ספר.",
    input_schema: {
      type: "object" as const,
      properties: {
        staffId: { type: "string", description: "מזהה ספר (אופציונלי) — להצגת השירותים המותאמים שלו" },
      },
      required: [],
    },
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
    name: "find_parallel_slots",
    description:
      "מחזיר אך ורק שעות שבהן כמה ספרים פנויים באותה שעה בדיוק — הבסיס היחיד לקביעה 'לבוא יחד, כל אחד אצל ספר אחר, במקביל' (למשל אב עם ילד, או שני חברים). " +
      "חובה להשתמש בו בכל פעם שרוצים לקבוע לשני אנשים או יותר שמגיעים יחד. לעולם אל תרכיב צמד של ספר+שעה בעצמך מרשימת שעות רגילה — רק מה שהכלי הזה החזיר הוא צמד תקף. " +
      "כל שעה שחוזרת כוללת את רשימת הספרים שפנויים בה עם המזהים שלהם; קבע כל אדם אצל אחד מהם. אם לא צוין תאריך — סורק קדימה ומחזיר את היום הקרוב שיש בו שעה מקבילה כזו.",
    input_schema: {
      type: "object" as const,
      properties: {
        date:      { type: "string", description: "תאריך YYYY-MM-DD (אופציונלי — בלעדיו מוחזר היום הקרוב עם שעה מקבילה)" },
        count:     { type: "number", description: "כמה ספרים צריכים להיות פנויים באותה שעה (מספר האנשים שמגיעים יחד). ברירת מחדל 2." },
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
        customerName:  { type: "string", description: "שם מלא של הלקוח. אם הלקוח כבר רשום במערכת — השתמש בשם שכבר רשום ואל תשנה אותו. אם זה לקוח חדש שאינו רשום — חובה שם פרטי + שם משפחה כדי לקבוע, אבל אל תבקש את השם בתחילת השיחה: קודם עזור ללקוח לבחור שירות, ספר, יום ושעה, ורק כשמגיעים לסגור את התור בקש ממנו את שמו המלא." },
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
    name: "request_appointment_move",
    description:
      "מעביר תור קיים של הלקוח לתאריך/שעה אחרים שהוא ביקש, עם כמה שפחות הטרדה לאחרים. " +
      "השתמש בו כשלקוח רוצה לשנות/להזיז את התור שלו לזמן מסוים (במקום לבטל ולקבוע מחדש). " +
      "קודם מצא את התור הקיים עם check_appointment כדי לקבל את ה-appointmentId. " +
      "המערכת מטפלת בכל הלוגיקה: אם השעה פנויה אצל הספר היא מעבירה מיד; אם הלקוח לא קפדן לגבי הספר (או לקוח חדש) והשעה פנויה אצל ספר אחר היא מעבירה לשם; ואם השעה תפוסה היא מחזירה לך את הזמנים הפנויים הכי קרובים כדי שתציע אותם ללקוח קודם — לפני שמטריחים מישהו. " +
      "רק אם הלקוח מתעקש דווקא על השעה התפוסה, קרא שוב לכלי עם insistExactTime=true, ואז הוא יבקש אישור מהספר ויציע ללקוחות אחרים להחליף. " +
      "קרא לזה רק אחרי שאישרת מול הלקוח לאיזה תאריך ושעה הוא רוצה לעבור. קרא את הטקסט שחוזר מהכלי ופעל לפיו מול הלקוח.",
    input_schema: {
      type: "object" as const,
      properties: {
        appointmentId:   { type: "string", description: "מזהה התור הקיים של הלקוח (מ-check_appointment)" },
        targetDate:      { type: "string", description: "התאריך הרצוי בפורמט YYYY-MM-DD" },
        targetStartTime: { type: "string", description: "השעה הרצויה בפורמט HH:MM" },
        allowOtherBarber: { type: "boolean", description: "true אם ללקוח לא אכפת אצל איזה ספר (או שהוא לקוח חדש בלי בקשה לספר מסוים). כברירת מחדל false — נשארים עם אותו ספר." },
        insistExactTime: { type: "boolean", description: "true רק אם הלקוח מתעקש דווקא על השעה שביקש למרות שהיא תפוסה, אחרי שהצעת לו את הזמנים הפנויים הקרובים והוא סירב. ברירת מחדל false. כשהוא true המערכת תתחיל תהליך החלפה מול הספר ולקוח אחר." },
      },
      required: ["appointmentId", "targetDate", "targetStartTime"],
    },
  },
  {
    name: "join_waitlist",
    description:
      "רושם את הלקוח לרשימת המתנה לתאריך מסוים — כך שאם יתפנה תור באותו יום הוא יקבל הודעה אוטומטית. " +
      "השתמש בו רק כשהלקוח מבקש במפורש שנעדכן אותו אם משהו יתפנה, או כשאין תור פנוי מתאים והלקוח רוצה להישאר ברשימה ליום הזה. " +
      "אל תשתמש בו במקום לקבוע תור פנוי — אם יש שעה שמתאימה ללקוח, קבע אותה עם book_appointment. " +
      "צריך serviceId (מ-get_services) ותאריך. staffId אופציונלי — העבר אותו רק אם הלקוח רוצה ספר מסוים; אחרת השאר ריק והרישום יתאים לכל ספר. " +
      "preferredTimeOfDay אופציונלי: 'morning' לבוקר, 'afternoon' לצהריים/אחר הצהריים, או 'any' (ברירת מחדל). " +
      "אם זה לקוח חדש שלא רשום, בקש קודם שם מלא והעבר אותו ב-customerName.",
    input_schema: {
      type: "object" as const,
      properties: {
        serviceId:          { type: "string", description: "מזהה השירות שהלקוח רוצה (מ-get_services)" },
        date:               { type: "string", description: "התאריך הרצוי בפורמט YYYY-MM-DD" },
        staffId:            { type: "string", description: "מזהה הספר, אם הלקוח רוצה ספר מסוים (אופציונלי — השאר ריק לכל ספר)" },
        preferredTimeOfDay: { type: "string", description: "'morning' | 'afternoon' | 'any' — חלק היום המועדף (אופציונלי, ברירת מחדל 'any')" },
        customerName:       { type: "string", description: "שם מלא של הלקוח — דרוש רק אם הוא לקוח חדש שאינו רשום" },
      },
      required: ["serviceId", "date"],
    },
  },
  {
    name: "escalate_to_human",
    description: "מעביר את הלקוח לטיפול אנושי ושולח התראה לספר הרלוונטי (או לבעל העסק) עם פרטי הלקוח והבעיה. לשימוש כשהלקוח מבקש לדבר עם ספר/בעל עסק, מתלונן, או כשהסוכן לא מצליח לעזור. נסה להעביר staffId אם ברור על איזה ספר מדובר (למשל הלקוח התלונן על תספורת אצל ניתאי) — אחרת המערכת תזהה לבד את הספר של הלקוח.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: { type: "string", description: "תיאור הבעיה בקצרה ובבירור — מה הלקוח רוצה / מה השתבש. זה הטקסט שיישלח לספר." },
        staffId: { type: "string", description: "מזהה הספר שאליו להעביר, אם ידוע (אופציונלי)" },
      },
      required: ["reason"],
    },
    // Cache breakpoint: the whole (static) tool block is read from cache on every
    // iteration of the loop and on follow-up turns, at ~10% of the token cost.
    cache_control: { type: "ephemeral" },
  },
];

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
        const svcStaffId = input.staffId as string | undefined;
        // With a staffId, show that barber's personal name/price/duration/note
        // (same underlying service — overrides via StaffService).
        if (svcStaffId) {
          const ssList = await prisma.staffService.findMany({
            where: { staffId: svcStaffId, service: { isVisible: true } },
            include: { service: { select: { id: true, name: true, price: true, durationMinutes: true, note: true, sortOrder: true } } },
          });
          if (ssList.length) {
            return ssList
              .sort((a, b) => a.service.sortOrder - b.service.sortOrder)
              .map(ss => {
                const name = ss.customName ?? ss.service.name;
                const price = ss.customPrice ?? ss.service.price;
                const dur = ss.customDuration ?? ss.service.durationMinutes;
                const note = ss.customNote ?? ss.service.note;
                return `• ${name} — ${price}₪, ${dur} דקות${note ? ` (${note})` : ""} [id: ${ss.service.id}]`;
              })
              .join("\n");
          }
          // No per-barber rows → fall through to the shared list.
        }
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
        if (!byStaff.length) {
          console.warn(`[agent] get_available_slots returned empty — biz=${bizId} date=${date} staffId=${inputStaffId ?? "any"} serviceId=${inputServiceId ?? "any"}`);
          return `אין תורים פנויים בתאריך ${date}.`;
        }
        const body = byStaff
          .map(s => `${s.name} [id: ${s.staffId}]: ${s.slots.join(", ")}`)
          .join("\n");
        // When several barbers come back, each line is a SEPARATE barber and the
        // times next to it are free ONLY for that barber. The model had merged
        // these into one flat list and then booked a time at a barber who didn't
        // actually have it. Switching barbers to satisfy the customer is fine —
        // the invariant is that the offered/confirmed time must come from the line
        // of the barber you will actually book with.
        if (byStaff.length > 1) {
          return `${body}\n\n⚠️ כל שורה היא ספר נפרד, והשעה שלצדו פנויה אך ורק אצלו. מותר לעבור בין ספרים כדי למצוא ללקוח שעה שמתאימה לו (למשל אם הוא רוצה מאוחר יותר ולספר הראשון אין) — אבל כל שעה שאתה מציע ומאשר חייבת לבוא מהשורה של הספר שאצלו תקבע בפועל, ותקבע עם ה-staffId שלו. לעולם אל תציג שעה כפנויה אצל ספר אחד כשהיא פנויה רק אצל אחר.`;
        }
        return body;
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
            // Return the FULL day per barber (morning through evening), not just
            // the first few. Truncating to the earliest slots hid the evening
            // availability, so when a customer asked for "ערב" the agent thought
            // the soonest day had none and skipped to the next day.
            const lines = byStaff
              .map(s => `${s.name} [id: ${s.staffId}]: ${s.slots.join(", ")}`)
              .join("\n");
            const warn = byStaff.length > 1
              ? `\n\n⚠️ כל שורה היא ספר נפרד; השעה פנויה רק אצל הספר שלצדה. מותר לעבור בין ספרים כדי למצוא שעה שמתאימה ללקוח, אבל כל שעה שתציע ותקבע חייבת לבוא מהשורה של הספר שאצלו תקבע בפועל.`
              : "";
            return `התאריך הפנוי הקרוב ביותר הוא ${ds} (זו כל הזמינות באותו יום, בוקר עד ערב):\n${lines}${warn}`;
          }
        }
        console.warn(`[agent] find_next_available returned empty — biz=${bizId} staffId=${inputStaffId ?? "any"} serviceId=${inputServiceId ?? "any"} scanned=${MAX_SCAN_DAYS}d`);
        return `לא נמצאו תורים פנויים ב-${MAX_SCAN_DAYS} הימים הקרובים.`;
      }

      // ── find_parallel_slots ──────────────────────────────────────────────────
      // Group booking ("come together, each at a different barber"). Returns ONLY
      // times where >= count barbers are genuinely free at the same slot, each
      // tagged with its staffId. The model cannot fabricate a barber+time pair
      // because the only pairs it ever sees are real overlaps.
      case "find_parallel_slots": {
        const { date: inDate, serviceId: inputServiceId } = input;
        const count = Math.max(2, Number(input.count) || 2);
        const fmt = (rows: { time: string; barbers: { staffId: string; name: string }[] }[]) =>
          rows
            .map(r => `${r.time}: ${r.barbers.map(b => `${b.name} [id: ${b.staffId}]`).join(" | ")}`)
            .join("\n");
        const guide = `\n\n⚠️ אלה השעות היחידות שבהן ${count} ספרים באמת פנויים יחד. קבע כל אדם אצל ספר אחר מתוך הרשומים לצד השעה, עם ה-staffId שלו. שעה שלא מופיעה כאן — אין בה ${count} ספרים פנויים, אל תציע אותה.`;
        if (inDate) {
          const rows = await computeParallelSlots(bizId, inDate as string, count, inputServiceId as string | undefined);
          if (!rows.length) {
            console.warn(`[agent] find_parallel_slots empty — biz=${bizId} date=${inDate} count=${count}`);
            return `אין בתאריך ${inDate} שעה שבה ${count} ספרים פנויים יחד. אפשר להציע רצוף אצל אותו ספר, או לבדוק יום אחר.`;
          }
          return `שעות שבהן ${count} ספרים פנויים יחד בתאריך ${inDate}:\n${fmt(rows)}${guide}`;
        }
        const nowBiz = getBusinessNow();
        const start = new Date(nowBiz.date + "T00:00:00.000Z");
        const MAX_SCAN_DAYS = 30;
        for (let d = 0; d < MAX_SCAN_DAYS; d++) {
          const dObj = new Date(start.getTime() + d * 24 * 60 * 60 * 1000);
          const ds = dObj.toISOString().slice(0, 10);
          const rows = await computeParallelSlots(bizId, ds, count, inputServiceId as string | undefined);
          if (rows.length) {
            return `היום הקרוב שבו ${count} ספרים פנויים יחד הוא ${ds}:\n${fmt(rows)}${guide}`;
          }
        }
        console.warn(`[agent] find_parallel_slots no day found — biz=${bizId} count=${count} scanned=${MAX_SCAN_DAYS}d`);
        return `לא נמצא ב-${MAX_SCAN_DAYS} הימים הקרובים יום שבו ${count} ספרים פנויים יחד באותה שעה. אפשר להציע רצוף אצל אותו ספר.`;
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
          // Diagnostic: this is the "agent said free, booking says taken" path.
          // Dump exactly what the guard saw so an intermittent rejection (e.g. the
          // model attributing another barber's free slot to THIS barber, or a slot
          // taken between the offer and the booking) is fully reconstructable.
          console.warn(
            `[agent] book guard REJECTED — biz=${bizId} reqStaff=${staffId}(${staff.name}) ` +
            `serviceId=${serviceId} date=${date} startTime=${startTime} | ` +
            `thisBarberSlots=[${staffSlots.join(",")}] | ` +
            `allBarbers=${JSON.stringify(dayAvail.map(s => ({ id: s.staffId, name: s.name, slots: s.slots })))}`
          );
          return `שגיאה: ${startTime} בתאריך ${date} לא פנוי אצל ${staff.name} (יום סגור, מעבר לאופק ההזמנות, או שהשעה נתפסה). אל תקבע את זה. קרא ל-get_available_slots לאותו יום או ל-find_next_available כדי לראות מה באמת פנוי, והצע ללקוח אפשרות תקפה — אצל ספר שפתוח באותו יום.`;
        }

        // Upsert customer — match either 0... or 972... so we don't duplicate.
        const localPhone = phone.replace(/^972/, "0");
        let customer = await prisma.customer.findFirst({ where: { businessId: bizId, OR: [{ phone }, { phone: localPhone }] } });

        // Count name words — a "full name" is first + last (≥ 2 words).
        const nameWords = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;

        if (!customer) {
          // NEW customer: never book without a full name. If the model only has
          // a first name, refuse and tell it to ask for first + last, THEN retry.
          if (nameWords(customerName) < 2) {
            return "שגיאה: זה לקוח חדש שאינו רשום במערכת, ואסור לקבוע תור בלי שם מלא. בקש מהלקוח בנימוס את שמו המלא — שם פרטי ושם משפחה — ורק אחרי שקיבלת את שניהם קרא שוב ל-book_appointment עם השם המלא. אל תקבע עם שם פרטי בלבד ואל תעביר לאדם בגלל זה.";
          }
          customer = await prisma.customer.create({
            data: { businessId: bizId, phone, name: customerName, referralSource: "whatsapp" },
          });
        } else if (nameWords(customerName) > nameWords(customer.name)) {
          // EXISTING customer: the name on file is the source of truth. Only
          // upgrade it when the new name is MORE complete (more words) — e.g.
          // first-name-only → full name. Never overwrite a stored full name with
          // a partial one the model may have passed.
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
        // Use THIS barber's own length & price (per-barber override), falling
        // back to base catalog values. Mirrors what computeDayAvailability used
        // for the slot grid, so endTime matches the slot the customer picked.
        const eff = await resolveStaffService(staffId, serviceId, service.name, service.durationMinutes, service.price);

        const apptDate = new Date(`${date}T00:00:00.000Z`);
        const startDateTime = new Date(`${date}T${startTime}:00.000Z`);
        const endDate  = new Date(startDateTime.getTime() + eff.duration * 60_000);
        const endTime  = endDate.toISOString().slice(11, 16);

        // Create appointment — guarded by a partial unique index on
        // (staff_id, date, start_time) WHERE status IN ('pending','confirmed').
        // If two requests race past the availability guard above, the DB will
        // reject the second one with a unique-violation (P2002) instead of
        // silently creating a double-booking.
        let appt;
        try {
          appt = await prisma.appointment.create({
            data: {
              businessId: bizId,
              customerId: customer.id,
              staffId,
              serviceId,
              date:      apptDate,
              startTime,
              endTime,
              status:    "confirmed",
              price:     eff.price,
              referralSource: "whatsapp_agent",
              source:    "agent",
            },
          });
        } catch (err: unknown) {
          // Unique-violation = slot was grabbed by another customer between the
          // guard check and this insert. Tell the model to offer an alternative.
          if ((err as { code?: string }).code === "P2002") {
            return `שגיאה: השעה ${startTime} ב-${date} אצל ${staff.name} נתפסה הרגע ע"י לקוח אחר. קרא ל-find_next_available כדי לראות מה פנוי ולהציע ללקוח חלופה.`;
          }
          throw err;
        }

        return `✅ תור נקבע בהצלחה!\n📅 ${date} ב-${startTime}\n💈 ${service.name} אצל ${staff.name}\n💰 ${eff.price}₪\nמזהה תור: ${appt.id}`;
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

        // Notify waitlist members — a slot just freed up. Awaited so the
        // immediate freed-slot message finishes sending before we return.
        await notifyWaitlistForCancellation({
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

      // ── request_appointment_move ─────────────────────────────────────────────
      case "request_appointment_move": {
        return await requestAppointmentMove({
          bizId,
          conversationId,
          callerPhone,
          appointmentId:   input.appointmentId,
          targetDate:      input.targetDate,
          targetStartTime: input.targetStartTime,
          allowOtherBarber: (input as Record<string, unknown>).allowOtherBarber === true,
          insistExactTime: (input as Record<string, unknown>).insistExactTime === true,
        });
      }

      // ── join_waitlist ────────────────────────────────────────────────────────
      case "join_waitlist": {
        const { serviceId, date } = input;
        const staffId = (input.staffId || "").trim() || null;
        const customerName = input.customerName;
        const rawPref = (input.preferredTimeOfDay || "").trim();
        const preferredTimeOfDay =
          ["morning", "afternoon", "any"].includes(rawPref) ? rawPref : "any";

        // Resolve the service (and optional staff) so we can fail clearly instead
        // of writing a dangling waitlist row the notifier can't render.
        const [service, staff] = await Promise.all([
          prisma.service.findFirst({ where: { id: serviceId, businessId: bizId }, select: { id: true, name: true } }),
          staffId
            ? prisma.staff.findFirst({ where: { id: staffId, businessId: bizId }, select: { id: true, name: true } })
            : Promise.resolve(null),
        ]);
        if (!service) return "שגיאה: לא נמצא השירות לפי המזהה. קרא ל-get_services כדי לקבל מזהה תקף ונסה שוב.";
        if (staffId && !staff) return "שגיאה: לא נמצא הספר לפי המזהה. קרא ל-get_staff_list כדי לקבל מזהה תקף, או השאר staffId ריק לרישום לכל ספר.";

        // Validate the date.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "שגיאה: התאריך חייב להיות בפורמט YYYY-MM-DD.";
        const dateObj = new Date(`${date}T00:00:00.000Z`);
        if (isNaN(dateObj.getTime())) return "שגיאה: תאריך לא תקין.";

        // The caller IS the customer — use their WhatsApp number. Upsert as in book.
        const phone = normalizeIsraeliPhone(callerPhone);
        const localPhone = phone.replace(/^972/, "0");
        const nameWords = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;
        let customer = await prisma.customer.findFirst({
          where: { businessId: bizId, OR: [{ phone }, { phone: localPhone }] },
        });
        if (!customer) {
          if (nameWords(customerName) < 2) {
            return "שגיאה: זה לקוח חדש שאינו רשום. בקש בנימוס את שמו המלא (שם פרטי ושם משפחה), ורק אחרי שקיבלת קרא שוב ל-join_waitlist עם customerName.";
          }
          customer = await prisma.customer.create({
            data: { businessId: bizId, phone, name: customerName, referralSource: "whatsapp" },
          });
        } else if (nameWords(customerName) > nameWords(customer.name)) {
          customer = await prisma.customer.update({ where: { id: customer.id }, data: { name: customerName } });
        }

        // Dedup: don't stack identical active rows (same biz+customer+staff+service+date).
        const existing = await prisma.waitlist.findFirst({
          where: {
            businessId: bizId,
            customerId: customer.id,
            staffId,
            serviceId,
            date: dateObj,
            status: { in: ["waiting", "notified"] },
          },
        });
        const dateLabel = dateObj.toLocaleDateString("he-IL", {
          weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem",
        });
        const staffLabel = staff ? ` אצל ${staff.name}` : "";
        if (existing) {
          return `הלקוח כבר רשום ברשימת ההמתנה ל-${service.name}${staffLabel} ב-${dateLabel}. אין צורך לרשום שוב — הוא יקבל הודעה אם יתפנה תור.`;
        }

        await prisma.waitlist.create({
          data: {
            businessId: bizId,
            customerId: customer.id,
            staffId,
            serviceId,
            date: dateObj,
            isFlexible: true,
            preferredTimeOfDay,
            status: "waiting",
          },
        });
        return `✅ רשמתי את הלקוח לרשימת המתנה ל-${service.name}${staffLabel} ב-${dateLabel}. אם יתפנה תור באותו יום הוא יקבל הודעה אוטומטית. עדכן את הלקוח בנימוס.`;
      }

      // ── escalate_to_human ────────────────────────────────────────────────────
      case "escalate_to_human": {
        const reason = (input.reason || "").trim() || "הלקוח ביקש לדבר עם נציג.";
        const { notified, targetStaffName } = await escalateToHuman({
          bizId,
          conversationId,
          callerPhone,
          reason,
          staffIdHint: input.staffId,
        });
        const target = targetStaffName ? `ל${targetStaffName}` : "לבעל העסק";
        return notified
          ? `הועברה התראה ${target} עם פרטי הלקוח והבעיה. אמור ללקוח שנציג יחזור אליו בהקדם.`
          : `סומן להעברה לאדם, אך לא נמצא מספר טלפון לשליחת התראה. אמור ללקוח שנציג יחזור אליו בהקדם.`;
      }

      default:
        return `כלי לא מוכר: ${name}`;
    }
  } catch (err) {
    console.error(`[agent tool ${name}]`, err);
    return `שגיאה בביצוע הפעולה: ${err instanceof Error ? err.message : "unknown"}`;
  }
}

/**
 * Hand a conversation to a human: resolve the right barber (explicit hint →
 * the customer's upcoming-appointment barber → most-visited barber → business
 * owner), WhatsApp them an alert with the customer + reason, then mute the agent
 * for this conversation (24h lazy expiry). Used both by the escalate_to_human
 * tool and by the "too many messages" auto-guard in runCustomerAgent.
 */
async function escalateToHuman(opts: {
  bizId: string;
  conversationId: string;
  callerPhone: string;
  reason: string;
  staffIdHint?: string | null;
}): Promise<{ notified: boolean; targetStaffName: string | null }> {
  const { bizId, conversationId, callerPhone, reason } = opts;
  const phone = normalizeIsraeliPhone(callerPhone);
  const localPhone = phone.replace(/^972/, "0");

  // Identify the customer (for the alert + to find their barber).
  const customer = await prisma.customer.findFirst({
    where: { businessId: bizId, OR: [{ phone }, { phone: localPhone }] },
    select: { id: true, name: true },
  });
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { whatsappName: true },
  });
  const custName = customer?.name || convo?.whatsappName || "לקוח";

  // Resolve which barber to alert:
  //   1. explicit staffId hint (verify it belongs to this biz)
  //   2. the customer's upcoming appointment's barber
  //   3. the barber the customer visits most (history)
  let targetStaff: { id: string; name: string; phone: string | null } | null = null;
  if (opts.staffIdHint) {
    targetStaff = await prisma.staff.findFirst({
      where: { id: opts.staffIdHint, businessId: bizId },
      select: { id: true, name: true, phone: true },
    });
  }
  if (!targetStaff && customer) {
    const todayStart = new Date(`${getBusinessNow().date}T00:00:00.000Z`);
    const upcoming = await prisma.appointment.findFirst({
      where: {
        customerId: customer.id, businessId: bizId,
        date: { gte: todayStart },
        status: { in: ["pending", "confirmed"] },
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      select: { staff: { select: { id: true, name: true, phone: true } } },
    });
    if (upcoming?.staff) targetStaff = upcoming.staff;
    if (!targetStaff) {
      // Fall back to the most-frequently-visited barber.
      const past = await prisma.appointment.findMany({
        where: { customerId: customer.id, businessId: bizId },
        select: { staff: { select: { id: true, name: true, phone: true } } },
        take: 50, orderBy: { date: "desc" },
      });
      const counts = new Map<string, { staff: { id: string; name: string; phone: string | null }; n: number }>();
      for (const a of past) {
        if (!a.staff) continue;
        const e = counts.get(a.staff.id) ?? { staff: a.staff, n: 0 };
        e.n++; counts.set(a.staff.id, e);
      }
      const top = Array.from(counts.values()).sort((x, y) => y.n - x.n)[0];
      if (top) targetStaff = top.staff;
    }
  }

  // Build the alert and pick a recipient (barber phone → business owner phone).
  const biz = await prisma.business.findUnique({
    where: { id: bizId }, select: { name: true, phone: true },
  });
  const custLine = `${custName} (${localPhone})`;
  let recipientPhone: string | null = null;
  let alert: string;
  if (targetStaff?.phone) {
    recipientPhone = targetStaff.phone;
    alert = `🔔 פנייה שדורשת טיפול\nלקוח: ${custLine}\nבעיה: ${reason}\n\nהלקוח ממתין בוואטסאפ — כדאי לחזור אליו.`;
  } else {
    recipientPhone = biz?.phone ?? null;
    const who = targetStaff ? `הספר ${targetStaff.name} (אין לו טלפון רשום)` : "לא זוהה ספר ספציפי";
    alert = `🔔 פנייה שדורשת טיפול (${who})\nלקוח: ${custLine}\nבעיה: ${reason}\n\nהלקוח ממתין בוואטסאפ — כדאי לחזור אליו.`;
  }

  let notified = false;
  if (recipientPhone) {
    try {
      await sendMessage({
        businessId: bizId,
        customerPhone: normalizeIsraeliPhone(recipientPhone),
        kind: "agent_escalation",
        body: alert,
      });
      notified = true;
    } catch (e) {
      console.error("[escalate] staff alert send failed", e);
    }
  }

  // Mute the agent for this conversation (24h lazy expiry) and mark escalated.
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "escalated", escalatedAt: new Date() },
  });

  return { notified, targetStaffName: targetStaff?.name ?? null };
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

כדי להזיז או לשנות תור קיים לזמן אחר: קודם מצא את התור עם check_appointment, ודא מול הלקוח לאיזה תאריך ושעה הוא רוצה לעבור, ואז קרא ל-request_appointment_move עם מזהה התור והזמן הרצוי. הכלי מטפל בהכל לבד — אם פנוי הוא מעביר מיד, ואם לא הוא מבקש אישור מהספר ומסדר החלפה מול לקוח אחר. אל תבטל ותקבע מחדש כדי להזיז זמן, ואל תבטיח ללקוח שעה תפוסה לפני שהכלי החזיר תשובה — קרא את מה שהכלי מחזיר ופעל לפיו. (לביטול מלא בלי זמן חלופי השתמש ב-cancel_appointment כרגיל.)

אם אין שעה פנויה ביום שהלקוח רוצה, או שהוא מבקש שנעדכן אותו אם יתפנה משהו — הצע לו להירשם לרשימת המתנה ליום הזה, וברגע שהוא מסכים קרא ל-join_waitlist עם השירות והתאריך (ועם הספר רק אם ביקש ספר מסוים). אם יתפנה תור באותו יום הוא יקבל הודעה אוטומטית. אל תשתמש ברשימת המתנה במקום לקבוע — אם יש שעה שמתאימה ללקוח, תמיד עדיף לסגור אותה.

יש לך כלים: get_staff_list, get_services, get_available_slots, find_next_available, book_appointment, check_appointment, cancel_appointment, request_appointment_move, join_waitlist, get_business_info ו-escalate_to_human. כשהלקוח מבקש את התור הכי קרוב או "מתי יש מקום" — קרא ל-find_next_available במקום לבדוק יום-יום. השתמש בהם מאחורי הקלעים כשצריך, בלי להכריז עליהם, ואל תזכיר ללקוח שמות של כלים או מספרי מזהה — דבר תמיד בשמות של ספרים ושירותים.`;
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
async function loadCustomerContext(businessId: string, phone: string, isFirstTurn: boolean): Promise<string> {
  // Customer.phone may be stored as 0... or 972... — try both. The same number
  // can sadly exist under BOTH formats as two separate records (with different
  // names), so fetch every match and pick deterministically: the one with the
  // most appointments (the real, active customer), then the most recent.
  const localPhone = phone.replace(/^972/, "0");
  const candidates = await prisma.customer.findMany({
    where: { businessId, deletedAt: null, OR: [{ phone }, { phone: localPhone }] },
    select: { id: true, name: true, createdAt: true },
  });
  if (!candidates.length) {
    const openLine = isFirstTurn
      ? 'זו ההודעה הראשונה בשיחה — פתח בברכה חמה וקצרה ("היי, מה קורה?") ואז המשך לעזור.'
      : "אל תפתח שוב בברכה, פשוט המשך ענייני מאיפה שהשיחה נמצאת.";
    return `זו הפעם הראשונה שהמספר הזה כותב — לקוח חדש שעדיין לא רשום אצלנו. ${openLine} במהלך קביעת התור שאל אותו איך קוראים לו.`;
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
  const greeting = isFirstTurn
    ? `זו ההודעה הראשונה בשיחה הזו — חובה לפתוח בברכה אישית חמה וקצרה בשמו ("היי ${fname}, מה קורה?" או "היי ${fname}, מה שלומך?") ואז להמשיך באותה הודעה ישר למה שביקש. אל תדלג על הברכה.`
    : `זו כבר לא ההודעה הראשונה בשיחה — אל תפתח שוב בברכה ("היי ${fname}...") ואל תכתוב "מה נוכל לעזור לך היום", פשוט המשך ענייני בדיוק מאיפה שהשיחה נמצאת.`;
  const parts = [
    `מי שמתכתב איתך עכשיו הוא ${fname}, לקוח שכבר רשום אצלנו. פנה אליו בשם הפרטי בלבד (${fname}) — לעולם לא בשם המלא או בשם משפחה — ואל תשאל אותו איך קוראים לו. ${greeting}`,
  ];

  // ── Upcoming (booked) appointments ──────────────────────────────────────────
  // The agent must be able to answer "מתי יש לי תור?" directly, without depending
  // on the customer to ask it to look. Surface every confirmed/pending future
  // appointment right here in the context. This is a REAL booked appointment —
  // distinct from a waitlist entry (handled separately below).
  const todayStart = new Date(`${getBusinessNow().date}T00:00:00.000Z`);
  const upcoming = await prisma.appointment.findMany({
    where: {
      customerId: customer.id,
      businessId,
      date:   { gte: todayStart },
      status: { in: ["pending", "confirmed"] },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: 3,
    select: {
      date: true,
      startTime: true,
      staff:   { select: { name: true } },
      service: { select: { name: true } },
    },
  });
  if (upcoming.length) {
    const list = upcoming
      .map(a => {
        const d = new Date(a.date).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
        return `${a.service.name} אצל ${a.staff.name} ביום ${d} בשעה ${a.startTime}`;
      })
      .join("; ");
    parts.push(`יש לו כבר תור קבוע: ${list}. אם הוא שואל מתי התור שלו — ענה לו מיד מהמידע הזה, בלי להפנות אותו לבדוק לבד. זה תור אמיתי שכבר נקבע (לא רשימת המתנה). ⚠️ זהו מידע על תור קיים בלבד, ולא מקור לבדיקת זמינות — לעולם אל תשתמש בתאריך או בשעה של התור הקיים כדי להציע זמן פנוי או לטעון "זה הכי קרוב שיש". לבדיקת זמינות קרא תמיד ל-get_available_slots או ל-find_next_available.`);
  } else {
    parts.push(`אין לו כרגע אף תור קבוע עתידי. אם ישאל "מתי התור שלי" — אמור לו בעדינות שאין לו תור קבוע כרגע, והצע לקבוע לו עכשיו.`);
  }

  const past = recent.filter(a => !a.status.startsWith("cancelled") && new Date(a.date) < todayStart);
  if (past.length) {
    const visits = past
      .map(a => {
        const d = new Date(a.date).toLocaleDateString("he-IL", { day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
        return `${a.service.name} אצל ${a.staff.name} ב-${d}`;
      })
      .join(", ");
    parts.push(`ביקורים אחרונים שלו: ${visits}. אם זה רלוונטי אפשר להציע את אותו ספר או שירות, אבל אל תניח — תמיד תוודא איתו.`);
  }

  // ── Preferred-barber signal (favorite vs. mixed) ─────────────────────────────
  // Over a wider window than the 3 shown above, decide whether the customer has a
  // clear go-to barber. A loyal customer should be offered their regular; a
  // customer who spreads visits across barbers has no preference, so we load-
  // balance (assign the least-busy one silently) — never ask "with whom?".
  const history = await prisma.appointment.findMany({
    where: {
      customerId: customer.id,
      businessId,
      status: { notIn: ["cancelled_by_customer", "cancelled_by_staff"] },
    },
    orderBy: { date: "desc" },
    take: 10,
    select: { staff: { select: { name: true, isAvailable: true } } },
  });
  if (history.length >= 3) {
    // Count visits ONLY for barbers who still work here. A customer's regular
    // may have left the shop (deactivated) — in that case there's no active
    // favorite to offer, so we fall through to load-balancing instead of
    // promising a barber the system can no longer book.
    const counts = new Map<string, number>();
    for (const h of history) {
      if (h.staff?.isAvailable) counts.set(h.staff.name, (counts.get(h.staff.name) ?? 0) + 1);
    }
    const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const activeTotal = ranked.reduce((sum, r) => sum + r[1], 0);
    const [topName, topCount] = ranked[0] ?? ["", 0];
    // Dominant = at least 3 visits to active barbers AND one of them holds ≥60%
    // (or is the only active barber the customer has ever used).
    const dominant =
      !!topName && activeTotal >= 3 && (ranked.length === 1 || topCount / activeTotal >= 0.6);
    if (dominant) {
      parts.push(`הספר הקבוע שלו הוא ${topName} (רוב הביקורים אצלו). אם הוא לא ביקש ספר אחר, אפשר להציע לו פעם אחת את ${topName} כרגיל ("אצל ${topName} כרגיל, או שלא קריטי?"). אם ענה שלא קריטי — קח את הפנוי ביותר.`);
    } else {
      // Either the customer spreads visits around, or their old regular no longer
      // works here. Don't surface a barber from history; load-balance silently.
      parts.push(`אין לו ספר קבוע פעיל אצלנו כרגע. אל תשאל אותו אצל מי הוא רוצה ואל תניח ספר מההיסטוריה; פשוט קבע אצל הספר הכי פנוי (איזון עומסים), בשקט.`);
    }
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
    parts.push(`הוא רשום ברשימת המתנה אצל: ${list}. המשמעות היחידה: זה הספר שהוא מעדיף, אז אם הוא רוצה לקבוע — נסה קודם אצלו. ⚠️ רישום לרשימת המתנה לא אומר שאין מקום! זה לא מקור מידע על זמינות. לעולם אל תסיק מזה שאין תורים פנויים ואל תזכיר את רשימת ההמתנה כסיבה לחוסר זמינות. כדי לדעת מה פנוי קרא תמיד ל-get_available_slots; אם יצא שעה פנויה — הצע וקבע אותה כרגיל.`);
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

  // ── Auto hand-off guard: too many messages without resolution ─────────────────
  // If the customer has sent more than the configured number of messages and the
  // conversation still isn't resolved, the agent is probably stuck in a loop (or
  // the case is genuinely too complex). Stop burning tokens, hand it to a human,
  // and tell the customer someone will follow up. 0 = disabled.
  const escalateThreshold = agentConfig?.escalateAfterMessages ?? 0;
  if (escalateThreshold > 0) {
    const userMsgCount = await prisma.conversationMessage.count({
      where: { conversationId: conversation.id, role: "user" },
    });
    if (userMsgCount >= escalateThreshold) {
      await escalateToHuman({
        bizId: businessId,
        conversationId: conversation.id,
        callerPhone: phone,
        reason: `השיחה נמשכת מעבר לרגיל (${userMsgCount} הודעות מהלקוח) בלי שנסגרה — ייתכן שהסוכן נתקע. כדאי לחזור ללקוח.`,
      });
      const handoffMsg = "אני מעביר אותך לטיפול אישי של אחד מהצוות — מישהו יחזור אליך בהקדם 🙏";
      await prisma.conversationMessage.create({
        data: { conversationId: conversation.id, role: "assistant", content: handoffMsg },
      });
      await sendMessage({ businessId, customerPhone: phone, kind: "agent_reply", body: handoffMsg })
        .catch(e => console.error("[agent] handoff message send failed", e));
      return;
    }
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
  // First turn = the agent has not replied in this conversation yet (no assistant
  // turn in history). Used to fire the personal greeting deterministically rather
  // than relying on the model to guess whether to greet.
  const isFirstTurn = !history.some(m => m.role === "assistant");
  const customerContext = await loadCustomerContext(businessId, phone, isFirstTurn);

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
