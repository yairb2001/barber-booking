/**
 * The owner's open setup tasks (15.10.2026, Yair: "כל שלב שהוא עצר ודילג,
 * שיופיע לו למעלה כמו משימה לחזור אליה (כמו וואטסאפ מנותק רק לא אדום)").
 *
 * Only after the wizard (inside it, the wizard leads). Read from the same
 * steps as the CRM's setup tracking (src/lib/crm/setup-progress.ts). The strip
 * at the top of the app shows the first task and how many are left. "הפעל"
 * has its own strip, so it isn't a task here.
 *
 * The last task is trying the agent like a customer: before "הפעל" the agent
 * answers only the test number, so without one he sets it first; once live,
 * any other phone will do.
 */
import { prisma } from "@/lib/prisma";
import { vocabOf } from "@/lib/vocab";
import { computeSetup } from "@/lib/crm/setup-progress";
import { testerPhones, TEST_NOTE } from "@/lib/agent/test-mode";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

export type SetupTask = { key: string; text: string; action: string; href: string; external?: boolean };

const TRY_TEXT = "היי, אפשר לקבוע תור?";
const local = (p: string) => p.replace(/^972/, "0");

export async function setupTasksFor(businessId: string): Promise<SetupTask[]> {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { onboardingCompletedAt: true, activatedAt: true, settings: true, phone: true, whatsappNumber: true, businessType: true } });
  if (!biz?.onboardingCompletedAt) return [];
  // A shop whose agent already booked a real customer is past all of this (cheap check, every page load).
  try { if (JSON.parse(biz.settings ?? "{}")?.setupProgress?.live) return []; } catch { /* go on */ }
  const [st] = await computeSetup({ businessIds: [businessId] });
  if (!st) return [];
  const done = (k: string) => st.steps.find(s => s.key === k)?.done ?? true;

  const tasks: SetupTask[] = [];
  if (!done("business")) tasks.push({ key: "business", text: "שעות הפתיחה עוד לא הוגדרו", action: "להגדרה", href: "/admin/settings/hours" });
  if (!done("team")) tasks.push({ key: "team", text: `עוד לא הוספת את ${vocabOf(biz).staffPluralDef}`, action: "להוספה", href: "/admin/staff" });
  if (!done("services")) tasks.push({ key: "services", text: "עוד אין שירותים ומחירים", action: "להוספה", href: "/admin/services" });
  if (!done("agent")) tasks.push({ key: "agent", text: "הגדרות הסוכן לא הושלמו", action: "להשלמה", href: "/admin/agent" });
  if (!done("whatsapp")) {
    tasks.push({ key: "whatsapp", text: "הוואטסאפ של העסק עוד לא מחובר", action: "לחיבור", href: "/admin/settings/whatsapp" });
    return tasks; // trying the agent needs the WhatsApp first
  }

  // Tried = the agent did something for the test number (a booking in test mode), or booked a real customer.
  const tried = st.isLive || (await prisma.messageLog.count({ where: { businessId, kind: "agent_reply", body: TEST_NOTE } })) > 0;
  if (!tried) {
    const testers = testerPhones(biz.settings);
    const shop = normalizeIsraeliPhone(biz.whatsappNumber || biz.phone || "");
    if (!biz.activatedAt && !testers.length) {
      tasks.push({ key: "tester", text: "כדי לנסות את הסוכן, קודם שמים מספר לבדיקה", action: "להגדרה", href: "/admin/agent" });
    } else if (shop) {
      const from = !biz.activatedAt ? `מהמספר ${local(testers[0])}` : "מטלפון אחר";
      tasks.push({ key: "try_agent", text: `נסה את הסוכן: שלח הודעה לעסק ${from} וקבע תור כמו לקוח`, action: "לוואטסאפ", href: `https://wa.me/${shop}?text=${encodeURIComponent(TRY_TEXT)}`, external: true });
    }
  }
  return tasks;
}
