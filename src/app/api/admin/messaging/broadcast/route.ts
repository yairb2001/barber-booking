import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage, applyTemplate } from "@/lib/messaging";
import { getRequestSession, scopedStaffId } from "@/lib/session";

// ── Shared customer-filter helper (mirrors customers/route.ts logic) ──────────
async function fetchFilteredCustomers(business: { id: string }, qs: string) {
  const params = new URLSearchParams(qs);
  const staffId      = params.get("staffId") || "";
  const upcoming     = params.get("upcoming") || "";
  const activeDays   = params.get("active_days") || "";
  const inactiveDays = params.get("inactive_days") || "";
  const newDays      = params.get("new_days") || "";
  // Legacy
  const inactiveWeeks = params.get("inactive_weeks") || "";
  const recentDays    = params.get("recent_days") || "";

  // Upcoming: find customers with appointments in a date range
  if (upcoming) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let rangeEnd = new Date(today);
    if (upcoming === "today")      rangeEnd.setDate(today.getDate() + 1);
    else if (upcoming === "tomorrow") { today.setDate(today.getDate() + 1); rangeEnd.setDate(today.getDate() + 1); }
    else if (upcoming === "3days") rangeEnd.setDate(today.getDate() + 3);
    else if (upcoming === "week")  rangeEnd.setDate(today.getDate() + 7);
    else                           rangeEnd.setDate(today.getDate() + 1);

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
    if (ids.length === 0) return [];

    return prisma.customer.findMany({
      where: { businessId: business.id, isBlocked: false, id: { in: ids } },
      select: { id: true, name: true, phone: true },
    });
  }

  // Standard customer filter
  type WhereClause = {
    businessId: string;
    isBlocked: boolean;
    appointments?: { some: { staffId: string } };
    lastVisitAt?: { gte?: Date; lte?: Date } | null;
    createdAt?: { gte: Date };
  };

  const where: WhereClause = { businessId: business.id, isBlocked: false };

  if (staffId) where.appointments = { some: { staffId } };

  if (activeDays) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - Number(activeDays));
    where.lastVisitAt = { gte: cutoff };
  } else if (inactiveDays) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - Number(inactiveDays));
    where.lastVisitAt = { lte: cutoff };
  } else if (inactiveWeeks) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - Number(inactiveWeeks) * 7);
    where.lastVisitAt = { lte: cutoff };
  } else if (recentDays) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - Number(recentDays));
    where.lastVisitAt = { gte: cutoff };
  }

  if (newDays) {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - Number(newDays));
    where.createdAt = { gte: cutoff };
  }

  return prisma.customer.findMany({
    where,
    select: { id: true, name: true, phone: true },
  });
}

// POST /api/admin/messaging/broadcast
export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const barberScopeId = scopedStaffId(req); // undefined = owner (all), string = barber's own id, null = unauth
  if (barberScopeId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const { message, filterQuery, filter = "all", filterValue } = body;

  if (!message || !message.trim()) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "no business" }, { status: 400 });

  // Use new filterQuery if provided; fall back to legacy params
  let qs = filterQuery || "";
  if (!qs && filter !== "all") {
    // Build legacy-style query string
    if (filter === "inactive_weeks" && filterValue) qs = `inactive_weeks=${filterValue}`;
    else if (filter === "recent_days" && filterValue) qs = `recent_days=${filterValue}`;
  }

  // Barbers can only message their own customers — force staffId in filter
  if (barberScopeId) {
    const params = new URLSearchParams(qs);
    params.set("staffId", barberScopeId);
    qs = params.toString();
  }

  const customers = await fetchFilteredCustomers(business, qs);

  if (customers.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, total: 0 });
  }

  let sent = 0, skipped = 0;

  const results = await Promise.allSettled(
    customers.map(async (customer) => {
      const personalizedMsg = applyTemplate(message, { name: customer.name });
      await sendMessage({
        businessId: business.id,
        customerPhone: customer.phone,
        kind: "broadcast",
        body: personalizedMsg,
      });
    })
  );

  results.forEach(r => (r.status === "fulfilled" ? sent++ : skipped++));
  return NextResponse.json({ ok: true, sent, skipped, total: customers.length });
}

// GET /api/admin/messaging/broadcast — broadcast history
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const barberScopeId = scopedStaffId(req);
  if (barberScopeId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json([]);

  // For barbers: only return broadcast history for their own customers
  // We filter by whether the customerPhone belongs to a customer who has an appointment with this staff
  let logs;
  if (barberScopeId) {
    // Get phone numbers of this barber's customers
    const myCustomers = await prisma.customer.findMany({
      where: {
        businessId: business.id,
        appointments: { some: { staffId: barberScopeId } },
      },
      select: { phone: true },
    });
    const myPhones = myCustomers.map(c => c.phone).filter(Boolean);
    logs = await prisma.messageLog.findMany({
      where: { businessId: business.id, kind: "broadcast", customerPhone: { in: myPhones } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  } else {
    logs = await prisma.messageLog.findMany({
      where: { businessId: business.id, kind: "broadcast" },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  return NextResponse.json(logs);
}
