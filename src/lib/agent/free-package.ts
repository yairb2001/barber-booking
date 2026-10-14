/**
 * The free package (14.10.2026, Yair: "אנחנו לא נותנים בחינם את המסלול הכי
 * יקר... אנחנו נותנים בחינם את המסלול הכי זול").
 *
 * A shop that doesn't pay yet gets the cheapest plan's quota ONCE, for
 * everything from signup until its free month ends: WhatsApp messages and the
 * agent's cost. Tests count too ("כשעושים עליו טסט, זה גונב מהחודש החינמי"):
 * the tester's chats before "הפעל" and the tries inside the admin. Used up
 * before the month is → the agent stops until he joins a plan ("יצטרך פשוט
 * לחדש"); reminders and confirmations keep going.
 */
import { prisma } from "@/lib/prisma";
import { USD_ILS } from "@/lib/fx";
import { SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";

/** Chator's own numbers (DOMINANT, the demo shop): never on a free package. */
const EXEMPT = new Set([SUPER_ADMIN_BUSINESS_ID, DEMO_BUSINESS_ID]);
export const onFreePackage = (biz: { id: string; paidAt: Date | null }) => !biz.paidAt && !EXEMPT.has(biz.id);

/** Alerts to the owner ride on the business's log; they are not its traffic. */
const NOT_TRAFFIC = ["wa_down_alert", "wa_up_alert", "wa_link_stuck", "token_alert_80", "token_alert_100", "free_alert_80", "free_alert_100"];
/** Our own runs on his account (quality review, cache warming). */
const NOT_HIS_USAGE = ["review", "cache_warm"];

export type FreePackage = {
  name: string;                                // the plan it copies ("בסיס")
  messages: { used: number; cap: number };
  aiIls: { used: number; cap: number };
  pct: number;                                 // the fuller of the two
  level: "ok" | "warn" | "blocked";
};

/** The cheapest active plan's quota. */
export async function freePackageCaps(): Promise<{ name: string; messages: number; aiBudgetIls: number }> {
  const { getPlans } = await import("@/lib/crm/plans"); // plans → token-budget → here: load late
  const p = (await getPlans()).filter(x => x.active !== false).sort((a, b) => a.priceIls - b.priceIls)[0];
  return { name: p?.name ?? "בסיס", messages: p?.messages ?? 1200, aiBudgetIls: p?.aiBudgetIls ?? 30 };
}

export async function freePackageState(biz: { id: string; createdAt: Date }): Promise<FreePackage> {
  const [caps, messages, ai] = await Promise.all([
    freePackageCaps(),
    prisma.messageLog.count({ where: { businessId: biz.id, status: "sent", createdAt: { gte: biz.createdAt }, kind: { notIn: NOT_TRAFFIC } } }),
    prisma.agentUsage.aggregate({ where: { businessId: biz.id, createdAt: { gte: biz.createdAt }, kind: { notIn: NOT_HIS_USAGE } }, _sum: { costUsd: true } }),
  ]);
  const aiUsed = Math.round((ai._sum.costUsd ?? 0) * USD_ILS * 10) / 10;
  const ratio = Math.max(caps.messages > 0 ? messages / caps.messages : 0, caps.aiBudgetIls > 0 ? aiUsed / caps.aiBudgetIls : 0);
  const pct = Math.round(ratio * 100);
  return {
    name: caps.name,
    messages: { used: messages, cap: caps.messages },
    aiIls: { used: aiUsed, cap: caps.aiBudgetIls },
    pct,
    level: pct >= 100 ? "blocked" : pct >= 80 ? "warn" : "ok",
  };
}
