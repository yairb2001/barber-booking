import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness } from "@/lib/session";
import { generateOccurrences, FOREVER_HORIZON_WEEKS } from "@/lib/recurring";

// ── GET — list recurring rules (optionally for a customer) ────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const activeOnly = searchParams.get("active") !== "false";

  // Staff scoping: barbers only see their own recurring rules
  const session = getRequestSession(req);
  const where: Record<string, unknown> = {
    ...(customerId ? { customerId } : {}),
    ...(activeOnly ? { active: true } : {}),
  };
  if (session && !session.isOwner && session.staffId) {
    where.staffId = session.staffId;
  }

  const rules = await prisma.recurringAppointment.findMany({
    where,
    include: { customer: true, staff: true, service: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rules);
}

// ── POST — create a recurring rule + generate first N occurrences ─────────────
//
// Body: {
//   customerId, staffId, serviceId,
//   dayOfWeek (0-6), startTime "HH:MM",
//   frequencyWeeks (1|2|4),
//   startDate "YYYY-MM-DD",
//   endDate? "YYYY-MM-DD",
//   price?, note?,
//   horizonWeeks? (default 12 = generate occurrences covering next 12 weeks)
// }
export async function POST(req: NextRequest) {
  const body = await req.json();

  // Staff scoping: barbers can only create rules for themselves
  const session = getRequestSession(req);
  if (session && !session.isOwner && session.staffId) {
    body.staffId = session.staffId;
  }

  const business = await getSessionBusiness(req);
  if (!business) return NextResponse.json({ error: "no business" }, { status: 400 });

  if (!body.customerId || !body.staffId || !body.serviceId ||
      body.dayOfWeek === undefined || !body.startTime || !body.startDate) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const service = await prisma.service.findUnique({ where: { id: body.serviceId } });
  if (!service) return NextResponse.json({ error: "service not found" }, { status: 400 });

  const freq = [1, 2, 4].includes(Number(body.frequencyWeeks)) ? Number(body.frequencyWeeks) : 1;
  const startDate = new Date(String(body.startDate).split("T")[0] + "T00:00:00.000Z");

  // Duration / horizon resolution.
  //  - forever:true  → standing series with NO endDate; we materialise the next
  //    FOREVER_HORIZON_WEEKS and a weekly cron tops it up (see /api/cron/recurring-topup).
  //  - otherwise     → finite series; horizonWeeks (or an explicit endDate) caps it.
  const forever = body.forever === true;
  const horizonWeeks = forever
    ? FOREVER_HORIZON_WEEKS
    : Math.min(Math.max(Number(body.horizonWeeks) || 12, 1), 52);

  const horizonEnd = new Date(startDate);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + horizonWeeks * 7);

  // endDate stored on the rule: null for "forever" (so the cron keeps extending it),
  // otherwise the explicit endDate or the computed finite horizon.
  const explicitEnd = body.endDate
    ? new Date(String(body.endDate).split("T")[0] + "T00:00:00.000Z")
    : null;
  const endDate = forever ? null : (explicitEnd ?? horizonEnd);

  // Create the rule
  const rule = await prisma.recurringAppointment.create({
    data: {
      businessId: business.id,
      customerId: body.customerId,
      staffId:    body.staffId,
      serviceId:  body.serviceId,
      dayOfWeek:  Number(body.dayOfWeek),
      startTime:  String(body.startTime),
      frequencyWeeks: freq,
      startDate,
      endDate,
      price: body.price !== undefined ? Number(body.price) : null,
      note:  body.note || null,
    },
  });

  // Materialise the first batch of occurrences (helper caps at rule.endDate when set).
  const { created, skipped } = await generateOccurrences(rule.id, startDate, horizonEnd);

  return NextResponse.json({ rule, created, skipped, forever }, { status: 201 });
}

// ── DELETE — cancel ALL recurring rules at once ───────────────────────────────
// Owner → every rule in the business; barber → only their own rules.
// Query:
//   ?future=true (default) → cancel future occurrences (from today forward)
//   ?future=all            → cancel every pending/confirmed occurrence
export async function DELETE(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("future") || "future";

  const ruleWhere: Record<string, unknown> = {
    businessId: session.businessId,
    active: true,
  };
  // Barbers can only wipe their own standing appointments.
  if (!session.isOwner && session.staffId) ruleWhere.staffId = session.staffId;

  const rules = await prisma.recurringAppointment.findMany({
    where: ruleWhere,
    select: { id: true },
  });
  const ruleIds = rules.map((r) => r.id);
  if (ruleIds.length === 0) {
    return NextResponse.json({ ok: true, rules: 0, cancelled: 0 });
  }

  const todayUTC = new Date(new Date().toISOString().split("T")[0] + "T00:00:00.000Z");
  const apptWhere: Record<string, unknown> = {
    recurringId: { in: ruleIds },
    status: { in: ["pending", "confirmed"] },
  };
  if (mode === "future") apptWhere.date = { gte: todayUTC };

  const { count } = await prisma.appointment.updateMany({
    where: apptWhere,
    data: { status: "cancelled_by_staff", cancelledAt: new Date() },
  });

  await prisma.recurringAppointment.updateMany({
    where: { id: { in: ruleIds } },
    data: { active: false },
  });

  return NextResponse.json({ ok: true, rules: ruleIds.length, cancelled: count });
}
