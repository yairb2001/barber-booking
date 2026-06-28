import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "dev-secret-change-in-production-please-set-AUTH_SECRET-env"
);

/**
 * Resolve a returning customer's "usual service" from their booking history, so
 * the smart suggestion can offer them the service THEY normally book (e.g. the
 * longer cut+beard) instead of the generic base service.
 *
 * Identity comes from the httpOnly `bk_session` cookie (set after the first OTP
 * verification). "Usual" = the service they booked the most times; ties broken
 * by whichever they booked most recently. Cancelled / no-show appointments are
 * ignored. Returns null for anonymous/new customers or any failure (the caller
 * then falls back to the base service) — this never throws.
 */
export async function getPreferredServiceId(
  request: Request,
  businessId: string | undefined
): Promise<string | null> {
  if (!businessId) return null;

  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)bk_session=([^;]+)/);
  if (!m) return null;

  try {
    const { payload } = await jwtVerify(decodeURIComponent(m[1]), SECRET);
    if (payload.type !== "customer_session" || payload.businessId !== businessId) return null;

    // Phone may be stored as 0... or 972... — try both forms.
    const phone = String(payload.phone ?? "");
    if (!phone) return null;
    const displayPhone = phone.startsWith("972") ? "0" + phone.slice(3) : phone;
    const variants = Array.from(new Set([phone, displayPhone]));

    const customer = await prisma.customer.findFirst({
      where: { businessId, phone: { in: variants } },
      select: { id: true },
    });
    if (!customer) return null;

    const grouped = await prisma.appointment.groupBy({
      by: ["serviceId"],
      where: {
        customerId: customer.id,
        status: { notIn: ["cancelled_by_customer", "cancelled_by_staff", "no_show"] },
      },
      _count: { serviceId: true },
      _max: { date: true },
    });
    if (grouped.length === 0) return null;

    grouped.sort((a, b) =>
      (b._count.serviceId - a._count.serviceId) ||
      ((b._max.date?.getTime() ?? 0) - (a._max.date?.getTime() ?? 0))
    );
    return grouped[0].serviceId;
  } catch {
    return null; // malformed cookie / DB hiccup → fall back to base service
  }
}
