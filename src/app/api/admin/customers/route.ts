import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

// POST — create a customer manually (independent of booking flow)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const name  = String(body.name  || "").trim();
  const phone = String(body.phone || "").replace(/\s/g, "");

  if (!name || !phone) {
    return NextResponse.json({ error: "name and phone required" }, { status: 400 });
  }

  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "no business" }, { status: 400 });

  // Upsert by (businessId, phone) — don't create duplicates
  const existing = await prisma.customer.findUnique({
    where: { businessId_phone: { businessId: business.id, phone } },
  });
  if (existing) {
    return NextResponse.json({ error: "לקוח עם מספר זה כבר קיים", customer: existing }, { status: 409 });
  }

  const customer = await prisma.customer.create({
    data: {
      businessId: business.id,
      name,
      phone,
      referralSource: body.referralSource || null,
      notificationPrefs: body.notes ? JSON.stringify({ notes: String(body.notes) }) : null,
    },
  });
  return NextResponse.json(customer, { status: 201 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q             = searchParams.get("q") || "";
  const limit         = Math.min(Number(searchParams.get("limit") || "30"), 2000);

  // ── Legacy params (kept for backward compat) ──
  const inactiveWeeks = searchParams.get("inactive_weeks");
  const recentDays    = searchParams.get("recent_days");

  // ── New filter params ──
  let staffId         = searchParams.get("staffId") || "";      // filter by barber
  const upcoming      = searchParams.get("upcoming") || "";     // today | tomorrow | 3days | week
  const activeDays    = searchParams.get("active_days") || "";  // visited in last N days
  const inactiveDays  = searchParams.get("inactive_days") || "";// no visit for N+ days
  const newDays       = searchParams.get("new_days") || "";     // created in last N days

  // Staff scoping: barbers only see their own customers
  const session = getRequestSession(req);
  if (session && !session.isOwner && session.staffId) {
    staffId = session.staffId;
  }

  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json([]);

  // ── Upcoming appointments filter: find customer IDs with appointments in date range ──
  if (upcoming) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let rangeEnd = new Date(today);

    if (upcoming === "today")    rangeEnd.setDate(today.getDate() + 1);
    else if (upcoming === "tomorrow") { today.setDate(today.getDate() + 1); rangeEnd.setDate(today.getDate() + 1); }
    else if (upcoming === "3days")  rangeEnd.setDate(today.getDate() + 3);
    else if (upcoming === "week")   rangeEnd.setDate(today.getDate() + 7);
    else rangeEnd.setDate(today.getDate() + 1);

    const appts = await prisma.appointment.findMany({
      where: {
        businessId: business.id,
        date: { gte: today, lt: rangeEnd },
        status: { notIn: ["cancelled_by_customer", "cancelled_by_staff"] },
        ...(staffId ? { staffId } : {}),
      },
      select: { customerId: true },
      distinct: ["customerId"],
    });
    const ids = appts.map(a => a.customerId);
    if (ids.length === 0) return NextResponse.json([]);

    const customers = await prisma.customer.findMany({
      where: { businessId: business.id, isBlocked: false, id: { in: ids } },
      orderBy: { name: "asc" },
      take: limit,
    });
    return NextResponse.json(customers);
  }

  // ── Base customer where clause ──
  type WhereClause = {
    businessId: string;
    isBlocked: boolean;
    appointments?: { some: { staffId: string } };
    lastVisitAt?: { gte?: Date; lt?: Date; lte?: Date } | null;
    createdAt?: { gte: Date };
    OR?: Array<{ name: { contains: string } } | { phone: { contains: string } }>;
  };

  const where: WhereClause = {
    businessId: business.id,
    isBlocked: false,
  };

  // Staff filter (customers who have had appointments with a specific barber)
  if (staffId) {
    where.appointments = { some: { staffId } };
  }

  // Active: visited in last N days
  if (activeDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(activeDays));
    where.lastVisitAt = { gte: cutoff };
  }
  // Inactive: no visit for N+ days
  else if (inactiveDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(inactiveDays));
    where.lastVisitAt = { lte: cutoff };
  }
  // Legacy inactive_weeks
  else if (inactiveWeeks) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(inactiveWeeks) * 7);
    where.lastVisitAt = { lte: cutoff };
  }
  // Legacy recent_days
  else if (recentDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(recentDays));
    where.lastVisitAt = { gte: cutoff };
  }

  // New customers: created in last N days
  if (newDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(newDays));
    where.createdAt = { gte: cutoff };
  }

  // Search query
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { phone: { contains: q } },
    ];
  }

  const customers = await prisma.customer.findMany({
    where,
    orderBy: { name: "asc" },
    take: limit,
  });
  return NextResponse.json(customers);
}
