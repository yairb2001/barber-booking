/**
 * The owner's personal payment link (10.10.2026): /pay/<slug>/<sig>. Sent in
 * the "free month is ending" WhatsApp and shown on "המסלול שלי". No login
 * needed; the HMAC makes it unguessable. The page opens Invoice4U's card
 * page for a monthly standing order at the business's plan price.
 */
import crypto from "node:crypto";

const sig = (businessId: string) => crypto.createHmac("sha256", process.env.AUTH_SECRET || "x").update(`pay:${businessId}`).digest("hex").slice(0, 16);

export function payLinkFor(b: { id: string; slug: string }): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
  return `${origin}/pay/${encodeURIComponent(b.slug)}/${sig(b.id)}`;
}

export function verifyPaySig(businessId: string, s: string): boolean {
  const want = sig(businessId);
  return typeof s === "string" && s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want));
}
