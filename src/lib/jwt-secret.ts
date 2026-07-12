// Single source of truth for the JWT signing secret.
//
// AUTH_SECRET signs the admin session, the OTP token, and the customer session.
// This helper FAILS CLOSED: if AUTH_SECRET is missing (or implausibly short) it
// throws instead of falling back to a hardcoded constant — a public fallback
// would make every token in the app forgeable. Cached after first read.
let _secret: Uint8Array | null = null;

export function authSecret(): Uint8Array {
  if (_secret) return _secret;
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET is not set (or too short). Refusing to sign/verify tokens.");
  }
  _secret = new TextEncoder().encode(s);
  return _secret;
}
