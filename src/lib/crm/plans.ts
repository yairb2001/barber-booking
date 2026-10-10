/**
 * Plans, monthly quotas and add-on packs (10.10.2026, Yair).
 *
 * A plan is a WhatsApp message quota (Yair, 10.10.2026: "לא להגביל תורים, רק
 * הודעות"). apptsCap is only the ESTIMATE shown at signup ("מתאים לכ־300
 * תורים"), never a limit: measured on DOMINANT ~3.4 messages per appointment
 * after the diet. The AI agent's raw budget stays as a cost safety net. Same plans for official and unofficial WhatsApp. No marketing
 * messages in any plan, only bought. Packs are priced at 3× our cost and
 * count for the month they were bought in.
 *
 * The business's plan lives in Business.settings.planKey; assigning a plan
 * also sets monthlyPrice and the AI budget (settings.tokenBudgetIls) that
 * token-budget.ts already enforces. An AI pack is a token-budget topup.
 */
import { prisma } from "@/lib/prisma";
import { USD_ILS } from "@/lib/fx";
import { budgetOf, currentMonth } from "@/lib/agent/token-budget";
import { getCrmSettings } from "@/lib/crm/core";

export const DEFAULT_PLANS = [
  { key: "base", name: "בסיס", apptsCap: 300, messages: 1200, aiBudgetIls: 30, priceIls: 287, sort: 1 },
  { key: "mid", name: "ביניים", apptsCap: 600, messages: 2400, aiBudgetIls: 60, priceIls: 497, sort: 2 },
  { key: "top", name: "עליון", apptsCap: 1000, messages: 4000, aiBudgetIls: 100, priceIls: 797, sort: 3 },
];

/** Re-engagement and promotion kinds — "marketing" on Meta's side, never in a plan. */
export const MARKETING_KINDS = ["rhythm_nudge", "rhythm_nudge_new", "reengage", "post_every_visit", "referral_thankyou", "broadcast"];

export type PackKind = "messages" | "ai" | "marketing";
export type Meter = { used: number; cap: number; pct: number };
export type Usage = { month: string; appts: Meter; messages: Meter; ai: Meter; marketing: Meter };

const parse = (raw: string | null | undefined): Record<string, unknown> => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };
const meter = (used: number, cap: number): Meter => ({ used, cap, pct: cap > 0 ? Math.round((used / cap) * 100) : used > 0 ? 100 : 0 });

let seeded: Promise<void> | null = null;
function seedPlans(): Promise<void> {
  if (!seeded) seeded = prisma.crmPlan.createMany({ data: DEFAULT_PLANS, skipDuplicates: true }).then(() => undefined).catch(e => { seeded = null; throw e; });
  return seeded;
}

export async function getPlans() {
  await seedPlans();
  return prisma.crmPlan.findMany({ orderBy: { sort: "asc" } });
}

export const planKeyOf = (settings: string | null | undefined): string | null => {
  const k = parse(settings).planKey;
  return typeof k === "string" ? k : null;
};

/** This month's meters for several businesses at once. */
export async function usageFor(businessIds: string[], now = new Date()): Promise<Map<string, Usage>> {
  const out = new Map<string, Usage>();
  if (!businessIds.length) return out;
  const { key, start } = currentMonth(now);
  const [plans, bizs, appts, msgs, mkt, ai, packs] = await Promise.all([
    getPlans(),
    prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, tier: true, settings: true } }),
    prisma.appointment.groupBy({ by: ["businessId"], where: { businessId: { in: businessIds }, createdAt: { gte: start } }, _count: { _all: true } }),
    prisma.messageLog.groupBy({ by: ["businessId"], where: { businessId: { in: businessIds }, createdAt: { gte: start }, status: "sent" }, _count: { _all: true } }),
    prisma.messageLog.groupBy({ by: ["businessId"], where: { businessId: { in: businessIds }, createdAt: { gte: start }, status: "sent", kind: { in: MARKETING_KINDS } }, _count: { _all: true } }),
    prisma.agentUsage.groupBy({ by: ["businessId"], where: { businessId: { in: businessIds }, createdAt: { gte: start }, NOT: { kind: "sandbox" } }, _sum: { costUsd: true } }),
    prisma.crmPack.groupBy({ by: ["businessId", "kind"], where: { businessId: { in: businessIds }, month: key }, _sum: { qty: true } }),
  ]);
  for (const b of bizs) {
    const plan = plans.find(p => p.key === planKeyOf(b.settings)) ?? null;
    const pack = (k: PackKind) => packs.find(p => p.businessId === b.id && p.kind === k)?._sum.qty ?? 0;
    const aiCap = budgetOf({ tier: b.tier, settings: b.settings }, key).total;
    const aiUsed = Math.round((ai.find(x => x.businessId === b.id)?._sum.costUsd ?? 0) * USD_ILS * 10) / 10;
    out.set(b.id, {
      month: key,
      appts: meter(appts.find(x => x.businessId === b.id)?._count._all ?? 0, plan?.apptsCap ?? 0),
      messages: meter(msgs.find(x => x.businessId === b.id)?._count._all ?? 0, (plan?.messages ?? 0) + pack("messages")),
      ai: meter(aiUsed, aiCap),
      marketing: meter(mkt.find(x => x.businessId === b.id)?._count._all ?? 0, pack("marketing")),
    });
  }
  return out;
}

/** Put a business on a plan: its key, monthly price and AI budget. */
export async function assignPlan(businessId: string, planKey: string): Promise<boolean> {
  const plan = (await getPlans()).find(p => p.key === planKey);
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { settings: true } });
  if (!plan || !biz) return false;
  const s = parse(biz.settings);
  s.planKey = plan.key;
  s.tokenBudgetIls = plan.aiBudgetIls;
  await prisma.business.update({ where: { id: businessId }, data: { settings: JSON.stringify(s), monthlyPrice: plan.priceIls } });
  return true;
}

/** Record an add-on for this month. An AI pack also tops up the token budget. */
export async function addPack(businessId: string, kind: PackKind, now = new Date()): Promise<{ qty: number; priceIls: number } | null> {
  const cs = await getCrmSettings();
  const { key } = currentMonth(now);
  const qty = kind === "messages" ? cs.packMessagesQty : kind === "ai" ? cs.packAiIls : cs.packMarketingQty;
  const priceIls = kind === "messages" ? cs.packMessagesPrice : kind === "ai" ? cs.packAiPrice : cs.packMarketingPrice;
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { settings: true } });
  if (!biz) return null;
  await prisma.crmPack.create({ data: { businessId, kind, qty, priceIls, month: key } });
  if (kind === "ai") {
    const s = parse(biz.settings);
    const topups = Array.isArray(s.tokenTopups) ? (s.tokenTopups as unknown[]) : [];
    s.tokenTopups = [...topups, { month: key, ils: qty }];
    await prisma.business.update({ where: { id: businessId }, data: { settings: JSON.stringify(s) } });
  }
  return { qty, priceIls };
}

const METER_LABEL: Record<"appts" | "messages" | "ai", string> = { appts: "תורים", messages: "הודעות", ai: "חבילת הסוכן" };

/** Hourly: a business that crossed 80% of a quota → one quiet CRM notification per month per meter. */
export async function scanQuotas(now = new Date()): Promise<void> {
  const { DEMO_BUSINESS_ID } = await import("@/lib/demo-widget");
  const { SUPER_ADMIN_BUSINESS_ID } = await import("@/lib/super-admin");
  const { recordCrmNotification } = await import("@/lib/crm/notify");
  const bizs = await prisma.business.findMany({ where: { id: { notIn: [DEMO_BUSINESS_ID, SUPER_ADMIN_BUSINESS_ID] }, suspendedAt: null }, select: { id: true, name: true, settings: true } });
  const withPlan = bizs.filter(b => planKeyOf(b.settings));
  const usage = await usageFor(withPlan.map(b => b.id), now);
  for (const b of withPlan) {
    const u = usage.get(b.id);
    if (!u) continue;
    const s = parse(b.settings);
    const alerts = (s.quotaAlerts ?? {}) as Record<string, string[]>;
    const done = new Set(alerts[u.month] ?? []);
    const hit = (["messages", "ai"] as const).filter(k => u[k].cap > 0 && u[k].pct >= 80 && !done.has(k));
    if (!hit.length) continue;
    for (const k of hit) {
      await recordCrmNotification(`${b.name}: ${u[k].pct}% מ${METER_LABEL[k]} של המסלול`, { kind: "customer", businessId: b.id, push: false });
      done.add(k);
    }
    s.quotaAlerts = { [u.month]: Array.from(done) };
    await prisma.business.update({ where: { id: b.id }, data: { settings: JSON.stringify(s) } }).catch(() => {});
  }
}
