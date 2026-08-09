import { jwtVerify } from "jose";
import { authSecret } from "@/lib/jwt-secret";
import { prisma } from "@/lib/prisma";

export type BlockStatus = {
  allBlocked: boolean;
  blockedStaffIds: Set<string>;
};

const NOT_BLOCKED: BlockStatus = { allBlocked: false, blockedStaffIds: new Set() };

/**
 * Resolve a returning customer's block status from their httpOnly `bk_session`
 * cookie, so the availability endpoints can exclude a blocked barber's slots
 * BEFORE the customer ever tries to book — a blocked customer must never learn
 * they were singled out, only see "no available times" like a fully-booked
 * barber. Mirrors getPreferredServiceId's cookie-parsing (raw Request, no
 * NextRequest available in these route handlers).
 *
 * Anonymous / unrecognized / any failure → NOT_BLOCKED (the final-submit guard
 * in /api/appointments and the agent's booking tool are the real enforcement;
 * this is a UX layer on top, not the security boundary).
 */
export async function getBlockStatus(
  request: Request,
  businessId: string | undefined
): Promise<BlockStatus> {
  if (!businessId) return NOT_BLOCKED;

  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)bk_session=([^;]+)/);
  if (!m) return NOT_BLOCKED;

  try {
    const { payload } = await jwtVerify(decodeURIComponent(m[1]), authSecret());
    if (payload.type !== "customer_session" || payload.businessId !== businessId) return NOT_BLOCKED;

    const phone = String(payload.phone ?? "");
    if (!phone) return NOT_BLOCKED;
    const displayPhone = phone.startsWith("972") ? "0" + phone.slice(3) : phone;
    const variants = Array.from(new Set([phone, displayPhone]));

    const customer = await prisma.customer.findFirst({
      where: { businessId, phone: { in: variants } },
      select: { isBlocked: true, staffBlocks: { select: { staffId: true } } },
    });
    if (!customer) return NOT_BLOCKED;

    return {
      allBlocked: customer.isBlocked,
      blockedStaffIds: new Set(customer.staffBlocks.map(b => b.staffId)),
    };
  } catch {
    return NOT_BLOCKED;
  }
}
