/**
 * Lists and maps kept in crm_settings as JSON (the numeric settings live in core.ts, which ignores
 * these keys): the hidden chats and the monthly marketing spend.
 */
import { prisma } from "@/lib/prisma";

async function getJson<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.crmSetting.findUnique({ where: { key } });
  try { return row ? (JSON.parse(row.value) as T) : fallback; } catch { return fallback; }
}
async function setJson(key: string, value: unknown): Promise<void> {
  const v = JSON.stringify(value);
  await prisma.crmSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

// ─── Hidden chats ────────────────────────────────────────────────────────────
// Yair (27.10.2026): chats with people he knows, small talk, are not leads and not "לא רלוונטי":
// they are hidden. A hidden chat leaves the CRM's lists, the WhatsApp funnel and the dashboard, and
// the sales agent and the follow-ups never write to it. Kept by the chat's phone ("972…" or "ig:…").

async function phoneSet(key: string): Promise<Set<string>> {
  const list = await getJson<unknown>(key, []);
  return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
}

export const hiddenChatPhones = () => phoneSet("hiddenChats");

export async function setChatHidden(phone: string, hidden: boolean): Promise<void> {
  const set = await hiddenChatPhones();
  if (hidden) set.add(phone); else set.delete(phone);
  await setJson("hiddenChats", Array.from(set));
}

// ─── Sales testers ───────────────────────────────────────────────────────────
// Yair (30.10.2026): numbers that own a shop and still try Chator's line as a new prospect. The
// sales agent treats them as strangers (no support, no lead), the funnel follows them up, and
// "איפוס" opens a fresh chat. Kept by phone ("972…").

export const salesTesterPhones = () => phoneSet("salesTesters");

// ─── Marketing spend ─────────────────────────────────────────────────────────
// Per month ("2026-10" → ₪), entered by hand in the finance screen, for the cost of a new customer.

export async function marketingSpend(): Promise<Record<string, number>> {
  const map = await getJson<Record<string, unknown>>("marketingSpend", {});
  return Object.fromEntries(Object.entries(map).filter(([k, v]) => /^\d{4}-\d{2}$/.test(k) && typeof v === "number" && v >= 0)) as Record<string, number>;
}

export async function setMarketingSpend(month: string, ils: number): Promise<Record<string, number>> {
  if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(ils) || ils < 0) throw new Error("bad_input");
  const map = await marketingSpend();
  map[month] = Math.round(ils);
  await setJson("marketingSpend", map);
  return map;
}
