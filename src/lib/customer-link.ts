/**
 * Personal "manage my appointments" link for a customer.
 *
 * `/book/my-appointments?k=<token>` — the token is a signed JWT carrying the
 * customer's phone (type "customer_link", 180 days). Opening the link signs
 * the browser in (sets the same bk_session cookie the OTP flow sets) so the
 * customer can move / cancel / rebook without another verification code.
 * Sent inside confirmation and reminder messages (the {{cancel_link}} slot),
 * i.e. only ever to the customer's own WhatsApp number.
 */
import { SignJWT } from "jose";
import { authSecret } from "@/lib/jwt-secret";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

export const CUSTOMER_LINK_TYPE = "customer_link";

export async function customerManageLink(businessId: string, phone: string, slug?: string | null): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
  const normalized = normalizeIsraeliPhone(phone);
  const path = `${slug ? `/${slug}` : ""}/book/my-appointments`;
  if (!normalized) return `${baseUrl}${path}`;
  try {
    const token = await new SignJWT({ phone: normalized, businessId, type: CUSTOMER_LINK_TYPE })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("180d")
      .sign(authSecret());
    return `${baseUrl}${path}?k=${token}`;
  } catch {
    return `${baseUrl}${path}`;
  }
}
