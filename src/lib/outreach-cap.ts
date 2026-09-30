/**
 * Proactive-outreach cap (stage 1, spec "אפיון שלב 1" §5).
 *
 * Every business decides how many messages it may send a customer on its own
 * initiative per month (settings.maxProactivePerCustomerMonth, 0–4, default
 * 2). Counted: the rhythm nudge ("הגיע הזמן לתור"), win-back ("מתגעגעים"),
 * the post-visit thank-you / review request. Not counted: reminders and
 * confirmations for a booked appointment, answers to the customer, waitlist
 * notices he asked for. Enforced where those automations enqueue.
 */
import { prisma } from "@/lib/prisma";
import { phoneVariants } from "@/lib/messaging/phone";
import { currentMonth } from "@/lib/agent/token-budget";

export const PROACTIVE_KINDS = ["rhythm_nudge", "rhythm_nudge_2", "rhythm_nudge_new", "reengage", "post_first_visit", "post_every_visit"];
export const DEFAULT_MAX_PROACTIVE = 2;

export function maxProactivePerMonth(settingsRaw: string | null | undefined): number {
  if (!settingsRaw) return DEFAULT_MAX_PROACTIVE;
  try {
    const s = JSON.parse(settingsRaw) as { maxProactivePerCustomerMonth?: unknown };
    const v = s.maxProactivePerCustomerMonth;
    return typeof v === "number" && v >= 0 && v <= 4 ? Math.floor(v) : DEFAULT_MAX_PROACTIVE;
  } catch { return DEFAULT_MAX_PROACTIVE; }
}

/**
 * Of the given phones, the ones that still have room this month. A cap of 0
 * means "no proactive messages at all". Failed sends count too (one attempt is
 * one interruption as far as the customer is concerned).
 */
export async function phonesWithinOutreachCap(businessId: string, phones: string[], settingsRaw: string | null | undefined, now = new Date()): Promise<Set<string>> {
  const max = maxProactivePerMonth(settingsRaw);
  const ok = new Set<string>();
  if (!phones.length) return ok;
  if (max <= 0) return ok;
  const variants = Array.from(new Set(phones.flatMap(p => phoneVariants(p))));
  const rows = await prisma.messageLog.findMany({
    where: { businessId, kind: { in: PROACTIVE_KINDS }, customerPhone: { in: variants }, createdAt: { gte: currentMonth(now).start } },
    select: { customerPhone: true },
  });
  const count = new Map<string, number>();
  for (const r of rows) for (const v of phoneVariants(r.customerPhone)) count.set(v, (count.get(v) ?? 0) + 1);
  for (const p of phones) {
    const n = Math.max(...phoneVariants(p).map(v => count.get(v) ?? 0), 0);
    if (n < max) ok.add(p);
  }
  return ok;
}
