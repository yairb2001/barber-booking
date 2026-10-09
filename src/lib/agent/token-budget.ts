/**
 * Token package per business (stage 1, spec "אפיון שלב 1" §4).
 *
 * Behind the scenes the package is a raw-cost budget in shekels per month
 * (decision 29.9: 40 ₪ at the launch price, 80 ₪ for a bigger shop) — the
 * business never sees money. What it sees is a token meter: "נוצלו X מתוך Y
 * טוקנים". Tokens here are WEIGHTED to price (input-token equivalents at the
 * Sonnet input rate), so a cached token counts a tenth and an output token
 * five times — exactly what the bill does. Every model call already lands in
 * AgentUsage with its cost, so the meter is a sum.
 *
 *   80%  → the owner gets one alert (push + WhatsApp) and Yair a push.
 *   100% → the customer agent stops answering: a customer gets the business's
 *          own fixed message (written in the setup wizard; default = greeting +
 *          booking link) once a day per phone. Everything in code — proposal
 *          confirmations, reminders, swaps, waitlist — keeps working.
 *
 * Settings (Business.settings JSON): tokenBudgetIls (override the tier
 * default), tokenTopups [{ month: "2026-09", ils }] (one-time additions),
 * agentUnavailableMessage (supports {{name}} / {{link}}).
 */
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { pushToOwner } from "@/lib/native/push";
import { notifyPlatformOwner } from "@/lib/super-admin";
import { buildBookingLink } from "@/lib/link-first";

/** Raw-cost budget (₪ / month) by tier; the launch price (287 ₪) rides on premium. */
export const TIER_TOKEN_BUDGET_ILS: Record<string, number> = { basic: 0, pro: 40, premium: 40 };
export const USD_ILS = Number(process.env.TOKEN_USD_ILS) || 3.65;
/** Sonnet input price, $ per token — the unit of a "weighted token". */
const USD_PER_WEIGHTED_TOKEN = 3 / 1_000_000;

import { DEFAULT_UNAVAILABLE_MESSAGE } from "@/lib/agent/unavailable-message";
export { DEFAULT_UNAVAILABLE_MESSAGE };

export type TokenBudgetState = {
  month: string;             // "2026-09" (Israel time)
  budgetIls: number;         // tier default + override + top-ups
  baseBudgetIls: number;
  topupIls: number;
  usedUsd: number;
  usedIls: number;
  usedTokens: number;        // weighted
  packageTokens: number;     // weighted
  pct: number;               // 0–100+ (100 = blocked)
  level: "ok" | "warn" | "blocked" | "none"; // none = no package (tier without agent)
};

type Settings = { tokenBudgetIls?: unknown; tokenTopups?: unknown; agentUnavailableMessage?: unknown; ownerLoginPhone?: unknown };

function parse(raw: string | null | undefined): Settings {
  if (!raw) return {};
  try { return JSON.parse(raw) as Settings; } catch { return {}; }
}

/** "YYYY-MM" in Israel time, and the UTC instant the month started there. */
export function currentMonth(now = new Date()): { key: string; start: Date } {
  const il = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  const key = `${il.getFullYear()}-${String(il.getMonth() + 1).padStart(2, "0")}`;
  // Month start in Israel = local midnight; Israel is UTC+2/+3 → subtract the offset.
  const offsetMin = (il.getTime() - new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime()) / 60000;
  const start = new Date(Date.UTC(il.getFullYear(), il.getMonth(), 1) - offsetMin * 60000);
  return { key, start };
}

export const weightedTokens = (usd: number) => Math.round(usd / USD_PER_WEIGHTED_TOKEN);

export function budgetOf(biz: { tier: string | null; settings: string | null }, monthKey: string): { base: number; topup: number; total: number } {
  const s = parse(biz.settings);
  const base = typeof s.tokenBudgetIls === "number" && s.tokenBudgetIls >= 0 ? s.tokenBudgetIls : (TIER_TOKEN_BUDGET_ILS[biz.tier ?? "basic"] ?? 0);
  const topups = Array.isArray(s.tokenTopups) ? (s.tokenTopups as { month?: string; ils?: number }[]) : [];
  const topup = topups.filter(t => t.month === monthKey && typeof t.ils === "number").reduce((a, t) => a + (t.ils as number), 0);
  return { base, topup, total: base + topup };
}

export async function tokenBudgetState(businessId: string, now = new Date()): Promise<TokenBudgetState> {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { tier: true, settings: true } });
  const { key, start } = currentMonth(now);
  const b = budgetOf(biz ?? { tier: "basic", settings: null }, key);
  const agg = await prisma.agentUsage.aggregate({ where: { businessId, createdAt: { gte: start }, NOT: { kind: "sandbox" } }, _sum: { costUsd: true } });
  const usedUsd = agg._sum.costUsd ?? 0;
  const usedIls = usedUsd * USD_ILS;
  const pct = b.total > 0 ? Math.round((usedIls / b.total) * 1000) / 10 : 0;
  const level: TokenBudgetState["level"] = b.total <= 0 ? "none" : pct >= 100 ? "blocked" : pct >= 80 ? "warn" : "ok";
  return { month: key, budgetIls: b.total, baseBudgetIls: b.base, topupIls: b.topup, usedUsd, usedIls, usedTokens: weightedTokens(usedUsd), packageTokens: weightedTokens(b.total / USD_ILS), pct, level };
}

async function ownerPhoneOf(businessId: string): Promise<{ phone: string | null; name: string; settings: string | null; slug: string; id: string }> {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, slug: true, phone: true, settings: true } });
  const s = parse(biz?.settings);
  const phone = (typeof s.ownerLoginPhone === "string" && s.ownerLoginPhone) || biz?.phone || null;
  return { phone: phone ? normalizeIsraeliPhone(phone) : null, name: biz?.name ?? "", settings: biz?.settings ?? null, slug: biz?.slug ?? "", id: biz?.id ?? businessId };
}

/** One alert per business per month per level, keyed on MessageLog (kind + month in body). */
async function alertOnce(businessId: string, kind: "token_alert_80" | "token_alert_100", month: string, body: string): Promise<boolean> {
  const dup = await prisma.messageLog.findFirst({ where: { businessId, kind, createdAt: { gte: currentMonth().start } }, select: { id: true } });
  if (dup) return false;
  const owner = await ownerPhoneOf(businessId);
  if (owner.phone) {
    await sendMessage({ businessId, customerPhone: owner.phone, kind, body }).catch(e => console.error("[token-budget] alert send failed", e));
  } else {
    await prisma.messageLog.create({ data: { businessId, customerPhone: "-", kind, body, status: "skipped", error: "no owner phone" } }).catch(() => {});
  }
  pushToOwner(businessId, { title: kind === "token_alert_80" ? "⚠️ 80% מחבילת הסוכן נוצלו" : "⛔ חבילת הסוכן נגמרה לחודש", body: body.split("\n")[0], data: { type: "tokens", month } }).catch(() => {});
  notifyPlatformOwner(`${kind === "token_alert_80" ? "⚠️ 80%" : "⛔ 100%"} חבילת טוקנים — ${owner.name} (${month})`, { kind: "customer", businessId, push: kind === "token_alert_100" }).catch(() => {});
  return true;
}

export type BudgetGate = { blocked: boolean; state: TokenBudgetState; unavailableMessage?: string };

/**
 * Called by the customer agent right before its first model call of a turn.
 * Sends the 80% / 100% alerts when they are due, and when the package is used
 * up returns the fixed message the customer should get instead of the model
 * (once per phone per 24h; the caller sends it — or collects it in a sandbox).
 */
export async function tokenBudgetGate(businessId: string, phone: string): Promise<BudgetGate> {
  const state = await tokenBudgetState(businessId);
  if (state.level === "none" || state.level === "ok") return { blocked: false, state };
  if (state.level === "warn") {
    await alertOnce(businessId, "token_alert_80", state.month, `⚠️ נוצלו ${state.pct}% מחבילת הטוקנים של הסוכן החודש (${fmtTokens(state.usedTokens)} מתוך ${fmtTokens(state.packageTokens)}). כשהחבילה תיגמר הסוכן יפסיק לענות ללקוחות עד תחילת החודש; תזכורות ואישורים ממשיכים. להרחבת החבילה — כתוב ליאיר.`);
    return { blocked: false, state };
  }
  // blocked
  await alertOnce(businessId, "token_alert_100", state.month, `⛔ חבילת הטוקנים של הסוכן נגמרה לחודש (${fmtTokens(state.packageTokens)}). הסוכן לא עונה ללקוחות חדשים עד תחילת החודש — כל לקוח שכותב מקבל את ההודעה הקבועה עם קישור ההזמנה, ומגיע אליך בפוש. תזכורות, אישורים והחלפות ממשיכים. להוספת חבילה — כתוב ליאיר.`);
  const owner = await ownerPhoneOf(businessId);
  const s = parse(owner.settings);
  const link = await buildBookingLink({ id: owner.id, slug: owner.slug });
  const recent = await prisma.messageLog.findFirst({ where: { businessId, customerPhone: phone, kind: "agent_unavailable", createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } }, select: { id: true } });
  if (recent) return { blocked: true, state };
  const tpl = (typeof s.agentUnavailableMessage === "string" && s.agentUnavailableMessage.trim()) || DEFAULT_UNAVAILABLE_MESSAGE;
  const cust = await prisma.customer.findFirst({ where: { businessId, OR: [{ phone }, { phone: phone.replace(/^972/, "0") }] }, select: { name: true } });
  const first = (cust?.name ?? "").trim().split(/\s+/)[0] || "";
  const unavailableMessage = tpl.replace(/\{\{\s*name\s*\}\}/g, first).replace(/\{\{\s*link\s*\}\}/g, link).replace(/היי\s+!/, "היי!").replace(/[ \t]{2,}/g, " ").trim();
  return { blocked: true, state, unavailableMessage };
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
