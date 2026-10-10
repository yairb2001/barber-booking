/**
 * The free month is ending (10.10.2026, Yair: "התראות לי ולהם שתכף הם
 * נרשמים"). A business that has not paid by the end of its trial is locked
 * out (getBusinessAccessBlock), so both sides hear in time, once each:
 *   • 5 days before → Yair: a CRM notification with push, and a task on the
 *     CRM home until it is paid. The owner hears from Chator's number then
 *     (the "trial_ending" automation) and sees a strip in his app for the
 *     last 7 days (/api/admin/me → trialEnding).
 *   • the last day → the owner: one push.
 * Hourly, never during quiet hours. Dedup in Business.settings.trialAlerts,
 * keyed by the end date, so an extended trial is announced again.
 */
import { prisma } from "@/lib/prisma";
import { getBusinessNow } from "@/lib/utils";
import { getPlans, planKeyOf } from "@/lib/crm/plans";
import { recordCrmNotification } from "@/lib/crm/notify";
import { notifyOwnerWeb } from "@/lib/native/web-push";
import { pushToOwner } from "@/lib/native/push";
import { SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";

const parse = (raw: string | null | undefined): Record<string, unknown> => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };
const dayLabel = (d: Date) => d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" });

export async function scanTrialEnding(now = new Date()): Promise<void> {
  const { minutes } = getBusinessNow();
  if (minutes < 9 * 60 || minutes >= 21 * 60) return;
  const bizs = await prisma.business.findMany({
    where: { paidAt: null, suspendedAt: null, trialEndsAt: { gt: now, lte: new Date(now.getTime() + 5 * 86400_000) }, id: { notIn: [SUPER_ADMIN_BUSINESS_ID, DEMO_BUSINESS_ID] } },
    select: { id: true, name: true, settings: true, trialEndsAt: true },
  });
  if (!bizs.length) return;
  const plans = await getPlans();
  for (const b of bizs) {
    const ends = b.trialEndsAt!;
    const s = parse(b.settings);
    const forKey = ends.toISOString().slice(0, 10);
    const prev = (s.trialAlerts ?? {}) as Record<string, string>;
    const sent: Record<string, string> = prev.for === forKey ? prev : { for: forKey };
    const plan = plans.find(p => p.key === planKeyOf(b.settings)) ?? null;
    const planLine = plan ? `מסלול ${plan.name}, ${plan.priceIls} ₪ לחודש` : "עוד לא בחר מסלול";
    let changed = false;

    if (!sent.yair) {
      await recordCrmNotification(`${b.name}: החודש החינמי נגמר ב${dayLabel(ends)}\n${planLine}. בלי תשלום עד אז הגישה נחסמת.`, { kind: "customer", businessId: b.id, push: true });
      sent.yair = now.toISOString(); changed = true;
    }
    if (!sent.owner && ends.getTime() - now.getTime() <= 30 * 3600_000) {
      const title = "החודש החינמי מסתיים מחר";
      const body = plan ? `ממשיכים במסלול ${plan.name}, ${plan.priceIls} ₪ לחודש. אפשר לשנות בהגדרות.` : "כדי להמשיך בלי הפסקה, בוחרים מסלול בהגדרות.";
      await notifyOwnerWeb(b.id, "billing", { title, body, url: "/admin/settings/plan", tag: "trial-ending" });
      await pushToOwner(b.id, { title, body, data: { type: "trial_ending" } }).catch(() => {});
      sent.owner = now.toISOString(); changed = true;
    }
    if (changed) {
      s.trialAlerts = sent;
      await prisma.business.update({ where: { id: b.id }, data: { settings: JSON.stringify(s) } }).catch(() => {});
    }
  }
}
