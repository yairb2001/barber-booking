/**
 * CRM members (25.10.2026): people with their own CRM login. Two scopes:
 * "admin", the whole CRM like Yair (Nika, Yair: "אני רוצה שלניקה יהיה גישה לכל
 * ה-CRM, היא מנהלת ראשית"), and "reports", only the shops' reports on the
 * agent: sending them to the fix agent and approving fixes. Stored in
 * crm_settings "crmMembers" with a bcrypt hash; added in the CRM settings.
 * The cookie is member-token.ts.
 */
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth";

export type MemberScope = "admin" | "reports";
export type CrmMember = { id: string; name: string; phone: string; passwordHash: string; scope: MemberScope; createdAt: string };
export const isScope = (x: unknown): x is MemberScope => x === "admin" || x === "reports";
const KEY = "crmMembers";
const digits = (p: string) => { const d = p.replace(/\D/g, ""); return d.startsWith("972") ? `0${d.slice(3)}` : d; };

/** What a reports member may read and do in /api/admin/crm. */
export const MEMBER_VIEWS = new Set(["whoami", "improvements", "conversation", "pushKey"]);
export const MEMBER_ACTIONS = new Set(["improvement.queue", "improvement.unqueue", "improvement.publish", "improvement.revise", "improvement.reopen", "improvement.reject", "improvement.revert", "improvement.decide",
  // Her own phone's pushes (member-push.ts), never Yair's devices.
  "push.subscribe", "push.status", "push.unsubscribe"]);

export async function getMembers(): Promise<CrmMember[]> {
  const row = await prisma.crmSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  try { const v = row ? JSON.parse(row.value) : []; return Array.isArray(v) ? v : []; } catch { return []; }
}
async function save(list: CrmMember[]) {
  const value = JSON.stringify(list);
  await prisma.crmSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

export async function addMember(input: { name: string; phone: string; password: string; scope?: MemberScope }): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = input.name.trim().slice(0, 40), phone = digits(input.phone);
  if (!name) return { ok: false, error: "חסר שם" };
  if (!/^0\d{8,9}$/.test(phone)) return { ok: false, error: "מספר טלפון לא תקין" };
  if (input.password.length < 6) return { ok: false, error: "סיסמה של 6 תווים לפחות" };
  const list = await getMembers();
  const rest = list.filter(m => m.phone !== phone);
  await save([...rest, { id: crypto.randomUUID(), name, phone, passwordHash: await hashPassword(input.password), scope: input.scope ?? "reports", createdAt: new Date().toISOString() }]);
  return { ok: true };
}

export async function setMemberScope(id: string, scope: MemberScope) {
  await save((await getMembers()).map(m => (m.id === id ? { ...m, scope } : m)));
}

export async function removeMember(id: string) {
  await save((await getMembers()).filter(m => m.id !== id));
}

export async function memberLogin(phone: string, password: string): Promise<CrmMember | null> {
  const p = digits(phone);
  for (const m of await getMembers()) if (m.phone === p && (await verifyPassword(password, m.passwordHash))) return m;
  return null;
}

/** May this member read the view / do the action? An "admin" member: everything Yair can in the CRM. */
export const memberMay = (m: CrmMember, what: { view?: string; action?: string }) =>
  m.scope === "admin" || (what.view ? MEMBER_VIEWS.has(what.view) : MEMBER_ACTIONS.has(what.action ?? ""));

/** A member with the whole CRM (scope "admin"), for routes outside /api/admin/crm that Yair's CRM screens call. */
export async function crmAdminMemberOf(req: NextRequest): Promise<CrmMember | null> {
  const m = await memberOf(req);
  return m?.scope === "admin" ? m : null;
}

/** The member the middleware verified for this request (x-crm-member-id), if any. */
export async function memberOf(req: NextRequest): Promise<CrmMember | null> {
  const id = req.headers.get("x-crm-member-id");
  if (!id) return null;
  return (await getMembers()).find(m => m.id === id) ?? null;
}
