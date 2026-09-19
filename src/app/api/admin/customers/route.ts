import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness, barbersCanSeeAllCustomers } from "@/lib/session";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { computeRetention } from "@/lib/analytics/retention";

// Never cache this list — it must always reflect current customers.
export const dynamic = "force-dynamic";

// POST — create a customer manually (independent of booking flow)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const name  = String(body.name  || "").trim();
  // Normalize to E.164 (972...) so pasted contacts (with "+", spaces, dashes, or
  // invisible Unicode directional marks) don't break later phone-based lookups.
  const phone = normalizeIsraeliPhone(String(body.phone || "")) || String(body.phone || "").replace(/\s/g, "");

  if (!name || !phone) {
    return NextResponse.json({ error: "name and phone required" }, { status: 400 });
  }

  const business = await getSessionBusiness(req);
  if (!business) return NextResponse.json({ error: "no business" }, { status: 400 });

  // Upsert by (businessId, phone) — don't create duplicates
  const existing = await prisma.customer.findUnique({
    where: { businessId_phone: { businessId: business.id, phone } },
  });
  if (existing) {
    // A previously deleted customer with this phone → revive them instead of
    // erroring on the unique (businessId, phone) constraint.
    if (existing.deletedAt) {
      const revived = await prisma.customer.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          isBlocked: false,
          name,
          referralSource: body.referralSource || existing.referralSource || null,
          notes: body.notes ? String(body.notes) : existing.notes,
        },
      });
      return NextResponse.json(revived, { status: 200 });
    }
    return NextResponse.json({ error: "לקוח עם מספר זה כבר קיים", customer: existing }, { status: 409 });
  }

  const customer = await prisma.customer.create({
    data: {
      businessId: business.id,
      name,
      phone,
      referralSource: body.referralSource || null,
      notes: body.notes ? String(body.notes) : null,
    },
  });
  return NextResponse.json(customer, { status: 201 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q             = searchParams.get("q") || "";
  // Default to "all" (up to 5000) so the list never silently truncates — even
  // for older/cached frontends that don't pass an explicit limit. The customer
  // base is small (hundreds), so returning everyone is cheap.
  const limit         = Math.min(Number(searchParams.get("limit") || "5000"), 5000);

  // ── Legacy params (kept for backward compat) ──
  const inactiveWeeks = searchParams.get("inactive_weeks");
  const recentDays    = searchParams.get("recent_days");

  // ── New filter params ──
  let staffId         = searchParams.get("staffId") || "";      // filter by barber
  const upcoming      = searchParams.get("upcoming") || "";     // today | tomorrow | 3days | week
  const activeDays    = searchParams.get("active_days") || "";  // visited in last N days
  const inactiveDays  = searchParams.get("inactive_days") || "";// no visit for N+ days
  const newDays       = searchParams.get("new_days") || "";     // created in last N days
  // ── Customers-screen extras ──
  const stats         = searchParams.get("stats") === "1";      // attach visits / lastVisit / nextAppt / noShows
  const noFuture      = searchParams.get("no_future") === "1";  // only customers WITHOUT a live upcoming appointment
  const noShowsOnly   = searchParams.get("no_shows") === "1";   // only customers with an un-acked no-show
  const sort          = searchParams.get("sort") || "name";     // name | last_visit | visits

  // Load the business first so we can honor the "barbers can view all
  // customers" setting (default ON) before deciding whether to scope this barber.
  const session = getRequestSession(req);
  const business = await getSessionBusiness(req);
  if (!business) return NextResponse.json([]);

  // Staff scoping: a barber is limited to their OWN customers only when the
  // owner turned OFF "barbers can view all customers" (default ON). With it on,
  // barbers can search/list every shop customer (so they can book for anyone).
  if (session && !session.isOwner && session.staffId && !barbersCanSeeAllCustomers(business.settings)) {
    staffId = session.staffId;
  }

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
      where: { businessId: business.id, isBlocked: false, deletedAt: null, id: { in: ids } },
      orderBy: { name: "asc" },
      take: limit,
    });
    return NextResponse.json(customers);
  }

  // ── Base customer where clause ──
  type WhereClause = {
    businessId: string;
    isBlocked: boolean;
    deletedAt: null;
    appointments?: { some: { staffId: string } };
    lastVisitAt?: { gte?: Date; lt?: Date; lte?: Date } | null;
    createdAt?: { gte: Date };
    id?: { in: string[] };
    knownBefore?: boolean;
    OR?: Array<{ name: { contains: string; mode?: "insensitive" | "default" } } | { notes: { contains: string; mode?: "insensitive" | "default" } } | { phone: { contains: string } }>;
  };

  const where: WhereClause = {
    businessId: business.id,
    isBlocked: false,
    deletedAt: null,
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

  // New customers: FIRST REAL VISIT in the last N days — not "record created",
  // which also counts people who only wrote to the agent or joined a waitlist
  // (owner, 20.9.2026). Same definition as the dashboard retention card.
  if (newDays) {
    const days = Math.min(Math.max(Number(newDays) || 30, 1), 365);
    const ret = await computeRetention({ businessId: business.id, staffId: staffId || null, windows: [days] });
    where.id = { in: ret.windows[0].customers.map(x => x.id) };
  }

  // Search query — supports name or phone.
  // Phone stored in DB may be "0X..." or "972X..." so we search both variants.
  if (q) {
    const digits = q.replace(/\D/g, "");
    const phoneVariants: string[] = [q];
    if (digits.length >= 7) {
      // Build both local (0...) and international (972...) forms
      if (digits.startsWith("972")) {
        phoneVariants.push("0" + digits.slice(3)); // 972XXXXXXXXX → 0XXXXXXXXX
      } else if (digits.startsWith("0")) {
        phoneVariants.push("972" + digits.slice(1)); // 0XXXXXXXXX → 972XXXXXXXXX
      } else {
        phoneVariants.push("972" + digits); // bare digits
        phoneVariants.push("0" + digits);
      }
    }
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      ...phoneVariants.map(v => ({ phone: { contains: v } })),
    ];
  }

  // Only what the screens read — the full row (utm*, tokens, prefs) made the
  // 760-customer list ~450KB.
  let customers = await prisma.customer.findMany({
    where,
    orderBy: { name: "asc" },
    take: limit,
    select: {
      id: true, name: true, phone: true, createdAt: true, lastVisitAt: true,
      isBlocked: true, messagingOptOut: true, knownBefore: true,
      referralSource: true, notificationPrefs: true, notes: true,
    },
  });
  if (!stats && !noFuture && !noShowsOnly && sort === "name") return NextResponse.json(customers);

  // ── Per-customer stats in three grouped queries (not N+1) ──
  const ids = customers.map(c => c.id);
  const todayUTC = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const scope = staffId ? { staffId } : {};
  const [pastGroups, futureRows, noShowGroups] = await Promise.all([
    ids.length ? prisma.appointment.groupBy({
      by: ["customerId"],
      where: { businessId: business.id, customerId: { in: ids }, date: { lt: todayUTC }, status: { notIn: ["cancelled_by_customer", "cancelled_by_staff", "no_show"] }, ...scope },
      _count: { _all: true }, _max: { date: true },
    }) : [],
    ids.length ? prisma.appointment.findMany({
      where: { businessId: business.id, customerId: { in: ids }, date: { gte: todayUTC }, status: { in: ["pending", "confirmed"] }, ...scope },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      select: { customerId: true, date: true, startTime: true },
    }) : [],
    ids.length ? prisma.appointment.groupBy({
      by: ["customerId"],
      where: { businessId: business.id, customerId: { in: ids }, status: "no_show", ...scope },
      _count: { _all: true },
    }) : [],
  ]);
  const past = new Map(pastGroups.map(g => [g.customerId, { visits: g._count._all, lastVisit: g._max.date }]));
  const next = new Map<string, { date: Date; startTime: string }>();
  for (const r of futureRows) if (!next.has(r.customerId)) next.set(r.customerId, { date: r.date, startTime: r.startTime });
  const noShows = new Map(noShowGroups.map(g => [g.customerId, g._count._all]));

  type Row = (typeof customers)[number] & { visits: number; lastVisit: string | null; nextAppt: { date: string; startTime: string } | null; noShows: number };
  let rows: Row[] = customers.map(c => {
    let acked = false;
    try { acked = c.notificationPrefs ? !!JSON.parse(c.notificationPrefs).noShowAck : false; } catch { /* ignore */ }
    const p = past.get(c.id);
    const n = next.get(c.id);
    return {
      ...c,
      visits: p?.visits ?? 0,
      lastVisit: p?.lastVisit ? p.lastVisit.toISOString().slice(0, 10) : null,
      nextAppt: n ? { date: n.date.toISOString().slice(0, 10), startTime: n.startTime } : null,
      noShows: acked ? 0 : (noShows.get(c.id) ?? 0),
    };
  });
  if (noFuture) rows = rows.filter(r => !r.nextAppt);
  if (noShowsOnly) rows = rows.filter(r => r.noShows > 0);
  if (sort === "last_visit") rows.sort((a, b) => (b.lastVisit ?? "").localeCompare(a.lastVisit ?? ""));
  else if (sort === "visits") rows.sort((a, b) => b.visits - a.visits);
  customers = rows;
  return NextResponse.json(rows);
}
