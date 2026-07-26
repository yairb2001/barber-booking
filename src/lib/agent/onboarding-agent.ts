/**
 * Onboarding Agent — walks a freshly-signed-up owner through setting up their
 * shop, one WhatsApp question at a time, instead of a long on-screen form.
 *
 * Runs on the PLATFORM's own WhatsApp number (SUPER_ADMIN_BUSINESS_ID), not the
 * new business's — a brand-new business has no GreenAPI instance connected yet
 * (whatsappStatus starts "not_requested"), so there is no channel of its own to
 * receive/send on. The webhook routes an inbound message on the platform
 * instance to this agent when the sender's phone matches an owner with
 * `onboardingCompletedAt == null` (see the routing branch added there).
 * `sendMessage()` is called with `senderBusinessId: SUPER_ADMIN_BUSINESS_ID` so
 * delivery uses the platform's credentials while the MessageLog/Conversation
 * stay scoped to the actual (target) business.
 *
 * V1 scope: men's barbershops only (Business.businessKind). The step list and
 * tools below are deliberately generic (staff/services/hours as real DB rows,
 * policy via the same setup-fields.ts interview owner-agent already uses) so a
 * future niche just needs a different step list, not a rewrite of the engine.
 *
 * Connecting the business's OWN WhatsApp number stays a human (Yair) task for
 * now — see requestWhatsappConnection() below, which is the single hook to
 * replace once a self-serve number-provisioning system exists.
 */

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { sendMessage, firstName } from "@/lib/messaging";
import { SUPER_ADMIN_BUSINESS_ID, notifyPlatformOwner } from "@/lib/super-admin";
import { SETUP_FIELDS, type SetupConfig } from "@/lib/agent/setup-fields";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const MODEL_SMART = "claude-sonnet-4-6";
const MAX_HISTORY = 20;
const MAX_ITERATIONS = 8;

// ── Step list (source of truth for "what's left") ──────────────────────────
// `core` steps block finish_onboarding; optional ones can be skipped. Order is
// ask-order — get_onboarding_status always returns the first not-done step.
const ONBOARDING_STEPS: { key: string; core: boolean; label: string }[] = [
  { key: "basics",        core: true,  label: "פרטי עסק ובעלים (שם עסק, שם בעלים, כתובת)" },
  { key: "hours",         core: true,  label: "שעות פעילות שבועיות" },
  { key: "closed_days",   core: false, label: "ימי סגירה / חגים חד-פעמיים" },
  { key: "staff",         core: true,  label: "אנשי צוות נוספים (חוץ מהבעלים)" },
  { key: "services",      core: true,  label: "רשימת שירותים (שם, משך, מחיר)" },
  { key: "policy",        core: true,  label: "מדיניות ביטולים ומקדמה" },
  { key: "tone",          core: true,  label: "טון דיבור של הסוכן" },
  { key: "booking_rules", core: false, label: "כללי הזמנה (זמן מראש מינימלי/מקסימלי)" },
  { key: "whatsapp",      core: true,  label: "מספר וואטסאפ עסקי לחיבור" },
];
const STEP_KEYS = new Set(ONBOARDING_STEPS.map(s => s.key));

type OnboardingChatState = { doneSteps: string[] };

async function getOnboardingChatState(businessId: string): Promise<OnboardingChatState> {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { settings: true } });
  const settings = biz?.settings ? (JSON.parse(biz.settings) as Record<string, unknown>) : {};
  const raw = settings.onboardingChat as OnboardingChatState | undefined;
  return { doneSteps: Array.isArray(raw?.doneSteps) ? raw!.doneSteps : [] };
}

async function markStepDone(businessId: string, key: string): Promise<OnboardingChatState> {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { settings: true } });
  const settings = biz?.settings ? (JSON.parse(biz.settings) as Record<string, unknown>) : {};
  const state = (settings.onboardingChat as OnboardingChatState | undefined) ?? { doneSteps: [] };
  if (!state.doneSteps.includes(key)) state.doneSteps.push(key);
  settings.onboardingChat = state;
  await prisma.business.update({ where: { id: businessId }, data: { settings: JSON.stringify(settings) } });
  return state;
}

function nextStep(state: OnboardingChatState): { key: string; core: boolean; label: string } | null {
  return ONBOARDING_STEPS.find(s => !state.doneSteps.includes(s.key)) ?? null;
}

function missingCoreSteps(state: OnboardingChatState): string[] {
  return ONBOARDING_STEPS.filter(s => s.core && !state.doneSteps.includes(s.key)).map(s => s.label);
}

/**
 * Owner asked to connect their own WhatsApp number. Today this is a manual
 * hand-off to Yair (same mechanism as /api/admin/request-whatsapp) — flips the
 * flag and pings the platform admin. Kept as its OWN function so a future
 * self-serve provisioning flow only has to replace this body.
 */
async function requestWhatsappConnection(businessId: string, number: string): Promise<void> {
  await prisma.business.update({
    where: { id: businessId },
    data: { whatsappNumber: number, whatsappStatus: "requested" },
  });
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, slug: true } });
  await notifyPlatformOwner(
    `📲 בקשת חיבור WhatsApp מתהליך ה-onboarding\nעסק: ${biz?.name ?? "—"}\nslug: ${biz?.slug ?? "—"}\nמספר מבוקש: ${number}`
  );
}

// ── Tool schemas ─────────────────────────────────────────────────────────────
export const ONBOARDING_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_onboarding_status",
    description: "מחזיר אילו שלבים בשאלון כבר הושלמו, ומהו השלב הבא לשאול עליו. קרא לזה בתחילת השיחה ואחרי כל שלב שהושלם.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "save_business_basics",
    description: "שומר את שם העסק, שם הבעלים והכתובת הפיזית. גם יוצר את הבעלים כאיש צוות ראשון (אם עוד לא קיים). קרא בסיום שלב basics.",
    input_schema: {
      type: "object",
      properties: {
        businessName: { type: "string", description: "שם העסק (אופציונלי — לתקן את מה שהוזן בהרשמה)" },
        ownerName:    { type: "string", description: "שם מלא של בעל העסק" },
        address:      { type: "string", description: "כתובת פיזית מלאה" },
      },
      required: ["ownerName", "address"],
    },
  },
  {
    name: "save_business_hours",
    description: "שומר שעות פעילות שבועיות (על יומן הבעלים כברירת מחדל — עסק עם ספר אחד). לכל יום: פתוח/סגור ושעות. קרא בסיום שלב hours.",
    input_schema: {
      type: "object",
      properties: {
        schedule: {
          type: "array",
          description: "מערך של 7 ימים (0=ראשון..6=שבת)",
          items: {
            type: "object",
            properties: {
              day:       { type: "number", description: "0=ראשון..6=שבת" },
              isWorking: { type: "boolean" },
              start:     { type: "string", description: "HH:MM, נדרש אם isWorking" },
              end:       { type: "string", description: "HH:MM, נדרש אם isWorking" },
            },
            required: ["day", "isWorking"],
          },
        },
      },
      required: ["schedule"],
    },
  },
  {
    name: "save_closed_days",
    description: "שומר תאריכים חד-פעמיים שהעסק סגור בהם (חגים וכו'), על כל אנשי הצוות הקיימים. אפשר לקרוא עם skip=true אם אין כאלה כרגע. קרא בסיום שלב closed_days.",
    input_schema: {
      type: "object",
      properties: {
        holidays: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date:   { type: "string", description: "YYYY-MM-DD" },
              reason: { type: "string" },
            },
            required: ["date"],
          },
        },
        skip: { type: "boolean", description: "אין תאריכי סגירה חד-פעמיים כרגע" },
      },
    },
  },
  {
    name: "add_staff_member",
    description: "מוסיף איש צוות (ספר) נוסף — לא הבעלים עצמו. אפשר לקרוא כמה פעמים, פעם לכל איש צוות. שירותים מקושרים לפי שם (חייבים כבר להיות קיימים — קודם add_service).",
    input_schema: {
      type: "object",
      properties: {
        name:         { type: "string" },
        phone:        { type: "string" },
        serviceNames: { type: "array", items: { type: "string" }, description: "שמות שירותים שהוא נותן (חייבים כבר קיימים)" },
        schedule: {
          type: "array",
          description: "לו\"ז אישי, אותו מבנה כמו save_business_hours. אם לא צוין — מקבל את שעות הבעלים כברירת מחדל.",
          items: {
            type: "object",
            properties: {
              day: { type: "number" }, isWorking: { type: "boolean" },
              start: { type: "string" }, end: { type: "string" },
            },
            required: ["day", "isWorking"],
          },
        },
      },
      required: ["name"],
    },
  },
  {
    name: "add_service",
    description: "מוסיף שירות לרשימת השירותים של העסק. קרא פעם אחת לכל שירות. אחרי שהוספת את כולם — קרא ל-advance_onboarding_step עם key=\"services\".",
    input_schema: {
      type: "object",
      properties: {
        name:            { type: "string" },
        price:           { type: "number" },
        durationMinutes: { type: "number" },
      },
      required: ["name", "price", "durationMinutes"],
    },
  },
  {
    name: "save_policy",
    description: "שומר מדיניות ביטולים/מקדמה וטון דיבור. אפשר לקרוא עם כמה שדות בבת אחת. deposit הוא בוליאני; depositAmount רק אם deposit=true.",
    input_schema: {
      type: "object",
      properties: {
        cancelPolicy:  { type: "string", description: "למשל 'עד שעתיים לפני התור'" },
        deposit:       { type: "boolean" },
        depositAmount: { type: "string", description: "רק אם deposit=true" },
        tone:          { type: "string", description: "רשמי / חברי / קליל-רחוב" },
      },
    },
  },
  {
    name: "save_booking_rules",
    description: "שומר כללי הזמנה: כמה זמן מראש חובה להזמין לפחות (בדקות), וכמה זמן מראש מותר להזמין (בימים). יש ברירות מחדל סבירות (0 דק', 30 יום) — אפשר לדלג אם הבעלים לא בטוח.",
    input_schema: {
      type: "object",
      properties: {
        minLeadMinutes: { type: "number" },
        maxLeadDays:    { type: "number" },
      },
    },
  },
  {
    name: "request_whatsapp_connection",
    description: "שומר את מספר הוואטסאפ העסקי שהבעלים רוצה לחבר, ופותח בקשת חיבור (מטופלת ידנית בשלב זה). קרא בסיום שלב whatsapp.",
    input_schema: {
      type: "object",
      properties: { number: { type: "string", description: "מספר וואטסאפ עסקי, כל פורמט — ינורמל" } },
      required: ["number"],
    },
  },
  {
    name: "advance_onboarding_step",
    description: "מסמן שלב כהושלם (או שהבעלים בחר לדלג שלב לא-חובה). השתמש בזה אחרי ששמרת את הנתונים הרלוונטיים, או כדי לדלג שלב אופציונלי.",
    input_schema: {
      type: "object",
      properties: { key: { type: "string", description: "מזהה השלב (מ-get_onboarding_status)" } },
      required: ["key"],
    },
  },
  {
    name: "escalate_to_human",
    description: "מעביר את השיחה לטיפול אנושי (יאיר) — כשהבעלים מבקש במפורש \"לדבר עם בנאדם\", או כשאתה תקוע ולא מצליח לעזור אחרי שכבר ניסית להסביר.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
    },
  },
  {
    name: "finish_onboarding",
    description: "מסיים את תהליך ה-onboarding. עובד רק אם כל שלבי החובה הושלמו — אחרת מחזיר רשימה של מה שעוד חסר.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

// ── Tool executor ────────────────────────────────────────────────────────────
export async function execOnboardingTool(
  name: string,
  input: Record<string, unknown>,
  businessId: string,
): Promise<string> {
  switch (name) {
    case "get_onboarding_status": {
      const state = await getOnboardingChatState(businessId);
      const step = nextStep(state);
      if (!step) {
        return `כל השלבים הושלמו (${state.doneSteps.length}/${ONBOARDING_STEPS.length}). קרא ל-finish_onboarding כדי לסיים.`;
      }
      const missing = missingCoreSteps(state);
      return [
        `הושלמו ${state.doneSteps.length}/${ONBOARDING_STEPS.length} שלבים. עוד ${missing.length} שלבי חובה.`,
        `השלב הבא (key="${step.key}"): ${step.label}.`,
        step.core ? "שלב חובה." : "שלב רשות — הבעלים יכול לדלג (advance_onboarding_step).",
      ].join("\n");
    }

    case "save_business_basics": {
      const ownerName = String(input.ownerName || "").trim();
      const address = String(input.address || "").trim();
      const businessName = String(input.businessName || "").trim();
      if (!ownerName || !address) return "שגיאה: חסר שם בעלים או כתובת.";

      const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, phone: true, settings: true } });
      const settings = biz?.settings ? (JSON.parse(biz.settings) as Record<string, unknown>) : {};
      settings.ownerName = ownerName;
      await prisma.business.update({
        where: { id: businessId },
        data: { address, settings: JSON.stringify(settings), ...(businessName ? { name: businessName } : {}) },
      });

      // Seed the owner as staff #1 if not already there — hours/services attach
      // to a real staff row, and a solo shop needs no separate "team" step.
      const existingOwnerStaff = await prisma.staff.findFirst({ where: { businessId, role: "owner" } });
      if (!existingOwnerStaff) {
        await prisma.staff.create({
          data: { businessId, name: ownerName, phone: biz?.phone || null, role: "owner" },
        });
      }
      await markStepDone(businessId, "basics");
      return "נשמר ✅ פרטי עסק ובעלים.";
    }

    case "save_business_hours": {
      const schedule = Array.isArray(input.schedule) ? (input.schedule as Record<string, unknown>[]) : [];
      if (!schedule.length) return "שגיאה: לא התקבל לו\"ז.";
      const owner = await prisma.staff.findFirst({ where: { businessId, role: "owner" }, select: { id: true } });
      if (!owner) return "שגיאה: יש לשמור קודם את שלב basics (כדי שיהיה איש צוות לשייך אליו שעות).";
      for (const d of schedule) {
        const day = Number(d.day);
        const isWorking = d.isWorking === true;
        if (!Number.isInteger(day) || day < 0 || day > 6) continue;
        const slots = isWorking && d.start && d.end ? [{ start: String(d.start), end: String(d.end) }] : [];
        await prisma.staffSchedule.upsert({
          where: { staffId_dayOfWeek: { staffId: owner.id, dayOfWeek: day } },
          create: { staffId: owner.id, dayOfWeek: day, isWorking, slots: JSON.stringify(slots) },
          update: { isWorking, slots: JSON.stringify(slots) },
        });
      }
      await markStepDone(businessId, "hours");
      return "נשמר ✅ שעות פעילות.";
    }

    case "save_closed_days": {
      if (input.skip === true) {
        await markStepDone(businessId, "closed_days");
        return "סומן — אין ימי סגירה חד-פעמיים כרגע.";
      }
      const holidays = Array.isArray(input.holidays) ? (input.holidays as Record<string, unknown>[]) : [];
      if (!holidays.length) return "שגיאה: לא התקבלו תאריכים (או קרא עם skip=true אם אין).";
      const staff = await prisma.staff.findMany({ where: { businessId }, select: { id: true } });
      for (const h of holidays) {
        const dateStr = String(h.date || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
        const date = new Date(`${dateStr}T00:00:00.000Z`);
        for (const s of staff) {
          await prisma.staffScheduleOverride.upsert({
            where: { staffId_date: { staffId: s.id, date } },
            create: { staffId: s.id, date, isWorking: false, reason: (h.reason as string) || null },
            update: { isWorking: false, reason: (h.reason as string) || null },
          });
        }
      }
      await markStepDone(businessId, "closed_days");
      return `נשמרו ✅ ${holidays.length} ימי סגירה.`;
    }

    case "add_staff_member": {
      const name = String(input.name || "").trim();
      if (!name) return "שגיאה: חסר שם.";
      const serviceNames = Array.isArray(input.serviceNames) ? (input.serviceNames as unknown[]).map(String) : [];
      const staff = await prisma.staff.create({
        data: { businessId, name, phone: (input.phone as string) || null, role: "barber" },
      });

      if (serviceNames.length) {
        const services = await prisma.service.findMany({
          where: { businessId, name: { in: serviceNames, mode: "insensitive" } },
          select: { id: true, name: true },
        });
        for (const svc of services) {
          await prisma.staffService.create({ data: { staffId: staff.id, serviceId: svc.id } }).catch(() => {});
        }
        const notFound = serviceNames.filter(n => !services.some(s => s.name.toLowerCase() === n.toLowerCase()));
        if (notFound.length) {
          // Don't fail the whole call — staff member is created either way.
        }
      }

      const schedule = Array.isArray(input.schedule) ? (input.schedule as Record<string, unknown>[]) : [];
      const sourceSchedule = schedule.length
        ? schedule
        : (await prisma.staffSchedule.findMany({
            where: { staff: { businessId, role: "owner" } },
            select: { dayOfWeek: true, isWorking: true, slots: true },
          })).map(s => ({ day: s.dayOfWeek, isWorking: s.isWorking, slots: s.slots }));
      for (const d of sourceSchedule) {
        const day = Number((d as Record<string, unknown>).day ?? (d as Record<string, unknown>).dayOfWeek);
        if (!Number.isInteger(day) || day < 0 || day > 6) continue;
        const rec = d as Record<string, unknown>;
        const slots = rec.slots ? String(rec.slots) : JSON.stringify(
          rec.isWorking && rec.start && rec.end ? [{ start: rec.start, end: rec.end }] : []
        );
        await prisma.staffSchedule.upsert({
          where: { staffId_dayOfWeek: { staffId: staff.id, dayOfWeek: day } },
          create: { staffId: staff.id, dayOfWeek: day, isWorking: rec.isWorking === true, slots },
          update: { isWorking: rec.isWorking === true, slots },
        });
      }

      return `נוסף ✅ ${name} כאיש צוות. כשסיימת להוסיף את כולם, קרא ל-advance_onboarding_step עם key="staff".`;
    }

    case "add_service": {
      const name = String(input.name || "").trim();
      const price = Number(input.price);
      const durationMinutes = Math.round(Number(input.durationMinutes));
      if (!name || !Number.isFinite(price) || price < 0) return "שגיאה: חסר שם או מחיר לא תקין.";
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return "שגיאה: משך לא תקין.";
      await prisma.service.create({ data: { businessId, name, price, durationMinutes } });
      return `נוסף ✅ שירות "${name}" (${durationMinutes} דק', ${price}₪). כשסיימת להוסיף את כל השירותים, קרא ל-advance_onboarding_step עם key="services".`;
    }

    case "save_policy": {
      const cfg = await prisma.agentConfig.findUnique({ where: { businessId }, select: { setupConfig: true } });
      let setup: SetupConfig = {};
      if (cfg?.setupConfig) { try { setup = JSON.parse(cfg.setupConfig) as SetupConfig; } catch { setup = {}; } }

      const applied: string[] = [];
      if (typeof input.cancelPolicy === "string" && input.cancelPolicy.trim()) {
        setup.cancelPolicy = input.cancelPolicy.trim(); applied.push("מדיניות ביטולים");
      }
      if (typeof input.deposit === "boolean") {
        setup.deposit = input.deposit; applied.push("מקדמה");
      }
      if (typeof input.depositAmount === "string" && input.depositAmount.trim()) {
        setup.depositAmount = input.depositAmount.trim(); applied.push("סכום מקדמה");
      }
      if (typeof input.tone === "string" && SETUP_FIELDS.find(f => f.key === "tone")?.options?.includes(input.tone)) {
        setup.tone = input.tone; applied.push("טון");
      }
      if (!applied.length) return "שגיאה: לא התקבל אף שדה תקין. tone חייב להיות אחת מ: " + SETUP_FIELDS.find(f => f.key === "tone")?.options?.join(" / ");

      await prisma.agentConfig.upsert({
        where: { businessId },
        create: { businessId, setupConfig: JSON.stringify(setup) },
        update: { setupConfig: JSON.stringify(setup) },
      });
      if (setup.cancelPolicy && setup.deposit !== undefined) await markStepDone(businessId, "policy");
      if (setup.tone) await markStepDone(businessId, "tone");
      return `נשמר ✅ (${applied.join(", ")}).`;
    }

    case "save_booking_rules": {
      const data: Record<string, number> = {};
      if (Number.isFinite(Number(input.minLeadMinutes))) data.minBookingLeadMinutes = Math.max(0, Math.round(Number(input.minLeadMinutes)));
      if (Number.isFinite(Number(input.maxLeadDays))) data.bookingHorizonDays = Math.max(1, Math.round(Number(input.maxLeadDays)));
      if (Object.keys(data).length) await prisma.business.update({ where: { id: businessId }, data });
      await markStepDone(businessId, "booking_rules");
      return "נשמר ✅ כללי הזמנה.";
    }

    case "request_whatsapp_connection": {
      const number = String(input.number || "").trim();
      if (!number) return "שגיאה: לא התקבל מספר.";
      await requestWhatsappConnection(businessId, number);
      await markStepDone(businessId, "whatsapp");
      return "התקבל ✅ בקשת החיבור נשלחה לצוות דומיננט ותטופל בהקדם.";
    }

    case "advance_onboarding_step": {
      const key = String(input.key || "").trim();
      if (!STEP_KEYS.has(key)) return `שגיאה: שלב לא מוכר (${key}).`;
      const step = ONBOARDING_STEPS.find(s => s.key === key)!;
      if (step.core) return `שגיאה: "${step.label}" הוא שלב חובה — אי אפשר לדלג, רק לסמן הושלם אחרי ששמרת נתונים (או שהבעלים אמר שאין לו עוד — למשל 'staff' בלי אנשי צוות נוספים).`;
      await markStepDone(businessId, key);
      return `סומן ✅ (${step.label}).`;
    }

    case "escalate_to_human": {
      const reason = String(input.reason || "").trim();
      const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, phone: true } });
      await notifyPlatformOwner(
        `🆘 בקשת עזרה אנושית ב-onboarding\nעסק: ${biz?.name ?? "—"}\nטלפון: ${biz?.phone ?? "—"}${reason ? `\nסיבה: ${reason}` : ""}`
      );
      const conv = await prisma.conversation.findFirst({ where: { businessId, agentType: "onboarding" }, orderBy: { createdAt: "desc" } });
      if (conv) await prisma.conversation.update({ where: { id: conv.id }, data: { escalatedAt: new Date() } });
      return "הועבר ✅ לטיפול אנושי — מישהו מצוות דומיננט יחזור אליך בקרוב.";
    }

    case "finish_onboarding": {
      const state = await getOnboardingChatState(businessId);
      const missing = missingCoreSteps(state);
      if (missing.length) return `אי אפשר לסיים עדיין — עוד חסר: ${missing.join("; ")}.`;
      await prisma.business.update({ where: { id: businessId }, data: { onboardingCompletedAt: new Date() } });
      return "סיימנו! 🎉 ה-onboarding הושלם, המערכת מוכנה.";
    }

    default:
      return `שגיאה: כלי לא מוכר (${name}).`;
  }
}

// ── System prompt ────────────────────────────────────────────────────────────
function onboardingSystemPrompt(businessName: string): string {
  const now = new Date().toLocaleString("he-IL", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jerusalem",
  });
  return [
    `אתה סוכן ה-onboarding של דומיננט, מערכת ניהול תורים למספרות. אתה מדבר עם בעל עסק (${businessName}) שנרשם עכשיו למערכת.`,
    `המטרה: להוביל אותו שאלה-שאלה דרך הגדרת העסק שלו — לא טופס ארוך, שיחה טבעית וקצרה. שאלה אחת בכל פעם.`,
    `תמיד התחל (או המשך) בקריאה ל-get_onboarding_status כדי לדעת מה השלב הבא. שאל את השאלה במילים שלך (לא חייב להעתיק את ה-label מילה במילה), ואחרי שהוא עונה — שמור עם הכלי המתאים לאותו שלב.`,
    `שלבים רשות (closed_days, booking_rules) — אם הבעלים לא בטוח או רוצה לדלג, קרא ל-advance_onboarding_step. שלבי חובה — לא ניתן לדלג, אבל תשובה "אין לי עובדים נוספים" או "רק אני" היא תשובה לגיטימית לשלב staff (עדיין תצטרך לקרוא advance_onboarding_step עם key="staff" כדי לסמן שהתייחסת לזה).`,
    `אם הבעלים תקוע/לא מבין שאלה — נסה להסביר בעצמך קודם (למשל "מה זה מספר וואטסאפ עסקי" — זה המספר שהלקוחות שלו יכתבו אליו). רק אם זה לא עוזר, או שהוא מבקש במפורש "לדבר עם בנאדם" — קרא ל-escalate_to_human.`,
    `כשכל שלבי החובה הושלמו, קרא ל-finish_onboarding וברך אותו בקצרה.`,
    `ענה קצר, חם, בעברית, בלי להישמע כמו טופס. בלי להמציא נתונים — רק מה שהבעלים אמר בפועל.`,
    `עכשיו: ${now} (אסיה/ירושלים).`,
  ].join("\n");
}

// ── Public entry points ──────────────────────────────────────────────────────

/** Get-or-create the hidden onboarding conversation thread for a business. */
async function getOrCreateOnboardingConversation(businessId: string, phone: string, senderName?: string | null) {
  let conv = await prisma.conversation.findFirst({
    where: { businessId, agentType: "onboarding" },
    orderBy: { createdAt: "desc" },
  });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: {
        businessId, phone, agentType: "onboarding", status: "active",
        lastMessageAt: new Date(), whatsappName: senderName || null,
      },
    });
  }
  return conv;
}

/**
 * Sends the opening message right after signup. Called from the signup route.
 * Best-effort — never throws into the signup flow.
 */
export async function startOnboardingConversation(opts: {
  businessId: string;
  phone: string;
  ownerFirstName?: string;
}): Promise<void> {
  try {
    const conv = await getOrCreateOnboardingConversation(opts.businessId, opts.phone);
    const greeting =
      `${opts.ownerFirstName ? `היי ${firstName(opts.ownerFirstName)}` : "היי"}, כאן דומיננט 👋\n` +
      `בוא נגדיר יחד את המערכת שלך — כמה שאלות קצרות, אפשר בכל קצב. ` +
      `מה הכתובת המלאה של העסק, ומה השם המלא שלך כבעלים?`;
    await prisma.conversationMessage.create({
      data: { conversationId: conv.id, role: "assistant", content: greeting },
    });
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
    await prisma.business.update({ where: { id: opts.businessId }, data: { onboardingStartedAt: new Date() } });
    await sendMessage({
      businessId: opts.businessId,
      senderBusinessId: SUPER_ADMIN_BUSINESS_ID,
      customerPhone: opts.phone,
      kind: "onboarding_start",
      body: greeting,
    });
  } catch (e) {
    console.error("[onboarding-agent] startOnboardingConversation failed", e);
  }
}

/** Handles one inbound WhatsApp message from an owner mid-onboarding. */
export async function runOnboardingAgent(opts: {
  businessId: string;
  phone: string;
  incomingText: string;
  senderName?: string;
}): Promise<void> {
  const { businessId, phone, incomingText, senderName } = opts;

  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } });
  const businessName = business?.name || "העסק";

  const conv = await getOrCreateOnboardingConversation(businessId, phone, senderName);

  await prisma.conversationMessage.create({
    data: { conversationId: conv.id, role: "user", source: "agent", content: incomingText },
  });
  await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });

  const history = await prisma.conversationMessage.findMany({
    where: { conversationId: conv.id, role: { not: "tool" } },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY,
    select: { role: true, content: true },
  });
  const messages: Anthropic.MessageParam[] = history
    .reverse()
    .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  const system = onboardingSystemPrompt(businessName);

  let assistantText = "";
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: MODEL_SMART,
      max_tokens: 1024,
      system,
      tools: ONBOARDING_TOOLS,
      messages,
    });
    const u = response.usage;
    console.log(`[onboarding-agent] in=${u.input_tokens} out=${u.output_tokens}`);

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        let result: string;
        try {
          result = await execOnboardingTool(block.name, block.input as Record<string, unknown>, businessId);
        } catch (e) {
          console.error("[onboarding-agent] tool error", block.name, e);
          result = `שגיאה בביצוע ${block.name}.`;
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
        await prisma.conversationMessage.create({
          data: { conversationId: conv.id, role: "tool", content: result, toolName: block.name, toolCallId: block.id },
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

  if (!assistantText.trim()) assistantText = "קיבלתי, תודה.";

  const bubbles = assistantText.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
  for (let i = 0; i < bubbles.length; i++) {
    await prisma.conversationMessage.create({
      data: { conversationId: conv.id, role: "assistant", content: bubbles[i] },
    });
    await sendMessage({
      businessId, senderBusinessId: SUPER_ADMIN_BUSINESS_ID,
      customerPhone: phone, kind: "onboarding_reply", body: bubbles[i],
    });
    if (i < bubbles.length - 1) await new Promise(r => setTimeout(r, 600));
  }
}
