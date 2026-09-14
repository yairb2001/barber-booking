/**
 * Personal "manage my appointments" link for a customer — SHORT.
 *
 *   https://<host>/t/<token>   (token = 10 base58 chars, stored on Customer)
 *
 * /t/<token> resolves the customer, signs the browser in (same bk_session
 * cookie the OTP flow sets) and redirects to /book/my-appointments — so the
 * customer can move / cancel / rebook without a verification code. The token
 * is minted the first time a message needs it and reused after that; it is
 * only ever sent to the customer's own WhatsApp number. Reset by clearing
 * Customer.linkToken.
 */
import { prisma } from "@/lib/prisma";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { randomBytes } from "crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; // base58
export function mintLinkToken(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Existing token or a freshly minted one, persisted. */
export async function ensureLinkToken(customerId: string): Promise<string> {
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { linkToken: true } });
  if (c?.linkToken) return c.linkToken;
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = mintLinkToken();
    try {
      await prisma.customer.update({ where: { id: customerId }, data: { linkToken: token } });
      return token;
    } catch { /* unique collision — retry */ }
  }
  throw new Error("could not mint link token");
}

export async function customerManageLink(businessId: string, phone: string, _slug?: string | null): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
  const normalized = normalizeIsraeliPhone(phone);
  const local = normalized.startsWith("972") ? "0" + normalized.slice(3) : normalized;
  const fallback = `${baseUrl}/book/my-appointments`;
  if (!normalized) return fallback;
  try {
    const c = await prisma.customer.findFirst({ where: { businessId, deletedAt: null, phone: { in: [normalized, local] } }, select: { id: true } });
    if (!c) return fallback;
    const token = await ensureLinkToken(c.id);
    return `${baseUrl}/t/${token}`;
  } catch {
    return fallback;
  }
}

/** Legacy: ?k=<JWT> links already sent before the short /t/ links. Still accepted by /api/otp/auto-token. */
export const CUSTOMER_LINK_TYPE = "customer_link";
