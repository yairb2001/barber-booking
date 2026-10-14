/**
 * The joined shop's journey (14.10.2026, Yair approved): the time-based
 * starts of the CRM automations after the setup wizard. Hourly, from
 * scanTimeTriggers; each start is once per shop (the end of the free month:
 * once per end date). The texts, and whether each one runs, live in
 * /admin/crm/automations; they are seeded OFF.
 *
 *   finished the wizard, no "הפעל"   24h → not_activated (owner)   72h → not_activated_rep
 *   live, no customer booked          4d → quiet_start (owner)       5d → quiet_start_rep
 *   free month over, not paid         next day → trial_ended + trial_ended_rep
 *
 * Signup (signup_welcome) and the free package running out (free_used_up)
 * start from their own events: src/app/api/signup/route.ts, token-budget.ts.
 */
import { prisma } from "@/lib/prisma";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { startAutomation, type AutomationKey } from "@/lib/crm/automations";

const H = 3600_000;
const D = 24 * H;
const OURS = [DEMO_BUSINESS_ID, SUPER_ADMIN_BUSINESS_ID];

/** Finished the wizard at least `hours` ago and never pressed "הפעל". */
export async function notActivatedSince(hours: number, now = new Date()): Promise<string[]> {
  const rows = await prisma.business.findMany({
    where: { id: { notIn: OURS }, suspendedAt: null, activatedAt: null, onboardingCompletedAt: { lte: new Date(now.getTime() - hours * H) } },
    select: { id: true },
  });
  return rows.map(r => r.id);
}

/** Live for `days` or more (within its first month) and no customer booked since. */
export async function quietSinceActivation(days: number, now = new Date()): Promise<string[]> {
  const rows = await prisma.business.findMany({
    where: { id: { notIn: OURS }, suspendedAt: null, activatedAt: { lte: new Date(now.getTime() - days * D), gte: new Date(now.getTime() - 30 * D) } },
    select: { id: true, activatedAt: true },
  });
  const out: string[] = [];
  for (const b of rows) {
    const booked = await prisma.appointment.count({ where: { businessId: b.id, source: { in: ["customer", "agent"] }, createdAt: { gte: b.activatedAt! } } });
    if (!booked) out.push(b.id);
  }
  return out;
}

/** The free month ended in the last 3 days and nothing was paid. */
export async function trialEndedUnpaid(now = new Date()): Promise<{ id: string; trialEndsAt: Date }[]> {
  const rows = await prisma.business.findMany({
    where: { id: { notIn: OURS }, suspendedAt: null, paidAt: null, trialEndsAt: { lte: now, gte: new Date(now.getTime() - 3 * D) } },
    select: { id: true, trialEndsAt: true },
  });
  return rows.map(r => ({ id: r.id, trialEndsAt: r.trialEndsAt! }));
}

export async function scanJourney(now = new Date()): Promise<void> {
  const autos = await prisma.crmAutomation.findMany({
    where: { enabled: true, key: { in: ["not_activated", "not_activated_rep", "quiet_start", "quiet_start_rep", "trial_ended", "trial_ended_rep"] } },
    select: { id: true, key: true },
  });
  if (!autos.length) return;
  const on = (k: AutomationKey) => autos.find(a => a.key === k);
  const startOnce = async (k: AutomationKey, businessId: string, since = new Date(0)) => {
    const a = on(k);
    if (!a) return;
    if (await prisma.crmAutomationRun.count({ where: { automationId: a.id, businessId, startedAt: { gte: since } } })) return;
    await startAutomation(k, { businessId });
  };

  if (on("not_activated")) for (const id of await notActivatedSince(24, now)) await startOnce("not_activated", id);
  if (on("not_activated_rep")) for (const id of await notActivatedSince(72, now)) await startOnce("not_activated_rep", id);
  if (on("quiet_start")) for (const id of await quietSinceActivation(4, now)) await startOnce("quiet_start", id);
  if (on("quiet_start_rep")) for (const id of await quietSinceActivation(5, now)) await startOnce("quiet_start_rep", id);
  if (on("trial_ended") || on("trial_ended_rep")) {
    // Half a day after the end, so it reads as "the next day", not the last evening.
    for (const b of await trialEndedUnpaid(now)) {
      if (now.getTime() - b.trialEndsAt.getTime() < 12 * H) continue;
      await startOnce("trial_ended", b.id, b.trialEndsAt);
      await startOnce("trial_ended_rep", b.id, b.trialEndsAt);
    }
  }
}
