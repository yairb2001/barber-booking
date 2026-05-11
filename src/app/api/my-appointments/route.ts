import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "dev-secret-change-in-production-please-set-AUTH_SECRET-env"
);

/**
 * GET /api/my-appointments?phone=...&token=...&businessId=...
 *
 * Returns the customer's upcoming and recent past appointments.
 * Requires a valid OTP JWT token (issued by /api/otp/verify).
 *
 * Query params:
 *   phone      — customer phone (any Israeli format)
 *   token      — OTP JWT from /api/otp/verify
 *   businessId — (optional) scope to a specific business; uses findFirst if omitted
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const phone = searchParams.get("phone");
  const token = searchParams.get("token");
  const businessId = searchParams.get("businessId");

  if (!phone || !token) {
    return NextResponse.json({ error: "phone and token required" }, { status: 400 });
  }

  // Normalize phone to E.164 (same as OTP flow)
  const normalized = phone.replace(/\D/g, "").replace(/^0/, "972");

  // Verify OTP token
  let tokenPayload: { phone?: unknown; businessId?: unknown; type?: unknown } = {};
  try {
    const { payload } = await jwtVerify(token, SECRET);
    tokenPayload = payload as typeof tokenPayload;
  } catch {
    return NextResponse.json({ error: "פג תוקף הסשן — יש להתחבר מחדש" }, { status: 401 });
  }

  if (tokenPayload.type !== "otp" || tokenPayload.phone !== normalized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Resolve business
  const resolvedBusinessId = (businessId ?? tokenPayload.businessId) as string | undefined;
  const biz = resolvedBusinessId
    ? await prisma.business.findUnique({ where: { id: resolvedBusinessId }, select: { id: true } })
    : await prisma.business.findFirst({ select: { id: true } });

  if (!biz) return NextResponse.json({ error: "business not found" }, { status: 404 });

  // Find customer by phone (support both 0... and 972... formats)
  const customer = await prisma.customer.findFirst({
    where: {
      businessId: biz.id,
      OR: [
        { phone: normalized },
        { phone: "0" + normalized.slice(3) }, // convert 972... → 0...
      ],
    },
    select: { id: true, name: true, phone: true },
  });

  if (!customer) {
    // No appointments yet — return empty arrays
    return NextResponse.json({ upcoming: [], past: [] });
  }

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const todayDate = new Date(todayStr + "T00:00:00.000Z");

  const appointments = await prisma.appointment.findMany({
    where: {
      customerId: customer.id,
      status: { notIn: ["cancelled_by_customer", "cancelled_by_staff"] },
    },
    include: {
      staff:   { select: { id: true, name: true, avatarUrl: true } },
      service: { select: { id: true, name: true, durationMinutes: true } },
    },
    orderBy: [{ date: "desc" }, { startTime: "desc" }],
    take: 50,
  });

  const upcoming: typeof appointments = [];
  const past:     typeof appointments = [];

  for (const apt of appointments) {
    const aptDate = apt.date.toISOString().split("T")[0];
    if (aptDate > todayStr) {
      upcoming.push(apt);
    } else if (aptDate === todayStr) {
      // Same day — compare by time
      const [h, m] = apt.startTime.split(":").map(Number);
      const aptMinutes = h * 60 + m;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      if (aptMinutes >= nowMinutes) {
        upcoming.push(apt);
      } else {
        past.push(apt);
      }
    } else {
      past.push(apt);
    }
  }

  // upcoming: soonest first; past: most-recent first (already desc from DB)
  upcoming.reverse();

  return NextResponse.json({ upcoming, past, customer });
}
