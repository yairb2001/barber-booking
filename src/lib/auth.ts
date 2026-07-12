import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

// Fail CLOSED: never fall back to a hardcoded secret. If AUTH_SECRET is missing
// in any environment, signing/verification throws instead of silently using a
// public constant (which would make every admin/OTP token forgeable). Computed
// lazily so a missing env var surfaces at request time, not during build.
let _secret: Uint8Array | null = null;
function getSecret(): Uint8Array {
  if (_secret) return _secret;
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET is not set (or too short). Refusing to sign/verify tokens.");
  }
  _secret = new TextEncoder().encode(s);
  return _secret;
}

const ALG = "HS256";
export const COOKIE_NAME = "admin_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days
// Distinguishes an admin-session JWT from the OTP / customer-session JWTs, which
// are signed with the SAME secret. verifySession rejects any other type so an
// OTP token can never be replayed as an owner admin session.
const ADMIN_TOKEN_TYPE = "admin_session";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export type SessionPayload = {
  businessId: string;
  staffId?: string;   // undefined = owner (full access)
  role: "owner" | "barber";
};

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload, type: ADMIN_TOKEN_TYPE } as Record<string, unknown>)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifySession(
  token: string | undefined
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    // Reject any token minted for a different purpose (OTP / customer session).
    // Older admin tokens issued before this claim existed have no `type`, so we
    // only reject when a DIFFERENT type is explicitly present — those tokens
    // still carry an explicit role, which the check below requires anyway.
    if (payload.type !== undefined && payload.type !== ADMIN_TOKEN_TYPE) return null;
    if (typeof payload.businessId !== "string") return null;
    // Fail CLOSED on role: only an explicit "owner"/"barber" is accepted. A
    // missing/invalid role (e.g. an OTP token) is rejected, never defaulted to
    // owner.
    if (payload.role !== "owner" && payload.role !== "barber") return null;
    return {
      businessId: payload.businessId,
      staffId: typeof payload.staffId === "string" ? payload.staffId : undefined,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
};
