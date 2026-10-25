/**
 * CRM members (25.10.2026): people who log into the CRM for one job only.
 * Today one scope, "reports": the shops' reports on the agent, sending them
 * to the fix agent and approving fixes (Yair: "אשתי תאשר"). Stored in
 * crm_settings "crmMembers" with a bcrypt hash; Yair adds them in the CRM
 * settings. The cookie is member-token.ts.
 */
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth";

export type CrmMember = { id: string; name: string; phone: string; passwordHash: string; scope: "reports"; createdAt: string };
const KEY = "crmMembers";
const digits = (p: string) => { const d = p.replace(/\D/g, ""); return d.startsWith("972") ? `0${d.slice(3)}` : d; };

/** What a reports member may read and do in /api/admin/crm. */
export const MEMBER_VIEWS = new Set(["whoami", "improvements", "conversation"]);
export const MEMBER_ACTIONS = new Set(["improvement.queue", "improvement.unqueue", "improvement.publish", "improvement.revise", "improvement.reopen", "improvement.reject", "improvement.revert", "improvement.decide"]);

export async function getMembers(): Promise<CrmMember[]> {
  const row = await prisma.crmSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  try { const v = row ? JSON.parse(row.value) : []; return Array.isArray(v) ? v : []; } catch { return []; }
}
async function save(list: CrmMember[]) {
  const value = JSON.stringify(list);
  await prisma.crmSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

export async function addMember(input: { name: string; phone: string; password: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = input.name.trim().slice(0, 40), phone = digits(input.phone);
  if (!name) return { ok: false, error: "חסר שם" };
  if (!/^0\d{8,9}$/.test(phone)) return { ok: false, error: "מספר טלפון לא תקין" };
  if (input.password.length < 6) return { ok: false, error: "סיסמה של 6 תווים לפחות" };
  const list = await getMembers();
  const rest = list.filter(m => m.phone !== phone);
  await save([...rest, { id: crypto.randomUUID(), name, phone, passwordHash: await hashPassword(input.password), scope: "reports", createdAt: new Date().toISOString() }]);
  return { ok: true };
}

export async function removeMember(id: string) {
  await save((await getMembers()).filter(m => m.id !== id));
}

export async function memberLogin(phone: string, password: string): Promise<CrmMember | null> {
  const p = digits(phone);
  for (const m of await getMembers()) if (m.phone === p && (await verifyPassword(password, m.passwordHash))) return m;
  return null;
}

/** The member the middleware verified for this request (x-crm-member-id), if any. */
export async function memberOf(req: NextRequest): Promise<CrmMember | null> {
  const id = req.headers.get("x-crm-member-id");
  if (!id) return null;
  return (await getMembers()).find(m => m.id === id) ?? null;
}
