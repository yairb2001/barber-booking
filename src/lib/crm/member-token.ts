/**
 * A CRM login that sees only the reports screen (25.10.2026, Yair: "אשתי תאשר,
 * תבנה לה כניסה משלה"). Its own cookie, separate from the shops' admin login,
 * so being logged into a shop never mixes with it. Edge-safe (jose only): the
 * middleware reads it. Members themselves live in crm_settings (members.ts).
 */
import { SignJWT, jwtVerify } from "jose";

export const MEMBER_COOKIE = "crm_member";
export const MEMBER_MAX_AGE = 60 * 60 * 24 * 180; // 180 days: a home-screen app
const TYPE = "crm_member";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function signMemberToken(memberId: string): Promise<string> {
  return new SignJWT({ type: TYPE, mid: memberId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MEMBER_MAX_AGE}s`).sign(secret());
}

/** The member id, or null for anything else (an admin or customer token never passes). */
export async function verifyMemberToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.type === TYPE && typeof payload.mid === "string" ? payload.mid : null;
  } catch { return null; }
}

/** Where a member may go: the reports screen and the CRM API (which checks each view and action). */
export const isMemberPath = (p: string) => p === "/admin/crm/reports" || p.startsWith("/admin/crm/reports/") || p === "/api/admin/crm" || p === "/admin/crm/manifest.webmanifest";
