/**
 * GET /api/admin/analytics/customers
 *
 * Returns actual customer names for dashboard drill-down.
 *
 * Params:
 *   from      YYYY-MM-DD
 *   to        YYYY-MM-DD
 *   type      "new" | "returning"
 *   staffId?  filter to one barber
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness } from "@/lib/session";

export const dynamic = "force-dynamic";

const CANCELLED = new Set(["cancelled_by_customer", "cancelled_by_staff"]);

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const biz = await getSessionBusiness(req, { id: true });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });
  const bizId = biz.id;

  const { searchParams } = req.nextUrl;
  const fromStr = searchParams.get("from") ?? "";
  const toStr   = searchParams.get("to") ?? "";
  const type    = searchParams.get("type") ?? "new";
  const staffId = searchParams.get("staffId") || null;

  const effectiveStaffId = (!session.isOwner && session.staffId)
    ? session.staffId
    : staffId;

  if (!fromStr || !toStr)
    return NextResponse.json({ error: "missing from/to" }, { status: 400 });

  const fromDate = new Date(fromStr + "T00:00:00.000Z");
  const toDate   = new Date(toStr + "T23:59:59.999Z");
  const sf       = effectiveStaffId ? { staffId: effectiveStaffId } : {};
  const cancelledArr = Array.from(CANCELLED);

  if (type === "new") {
    // ── New customers: first-ever appointment (globally or with staff) is in [from,to]
    const periodAppts = await prisma.appointment.findMany({
      where: { businessId: bizId, date: { gte: fromDate, lte: toDate }, status: { notIn: cancelledArr }, ...sf },
      select: { customerId: true, customer: { select: { id: true, name: true, phone: true } } },
    });

    const custIds = Array.from(new Set(periodAppts.map(a => a.customerId)));
    if (custIds.length === 0) return NextResponse.json([]);

    // Get all-time history (respecting staff scope)
    const history = await prisma.appointment.findMany({
      where: { businessId: bizId, status: { notIn: cancelledArr }, customerId: { in: custIds }, ...sf },
      select: { customerId: true, date: true },
    });

    const firstDates = new Map<string, Date>();
    for (const a of history) {
      const d = new Date(a.date);
      const existing = firstDates.get(a.customerId);
      if (!existing || d < existing) firstDates.set(a.customerId, d);
    }

    // Customer map for names
    const custMap = new Map<string, { name: string; phone: string }>();
    for (const a of periodAppts) {
      if (!custMap.has(a.customerId)) {
        custMap.set(a.customerId, { name: a.customer.name, phone: a.customer.phone });
      }
    }

    const newCustomers = custIds
      .filter(id => {
        const first = firstDates.get(id);
        return first && first >= fromDate && first <= toDate;
      })
      .map(id => {
        const c = custMap.get(id)!;
        return { id, name: c.name, phone: c.phone, firstVisit: firstDates.get(id)!.toISOString().slice(0, 10) };
      })
      .sort((a, b) => a.firstVisit.localeCompare(b.firstVisit));

    return NextResponse.json(newCustomers);

  } else if (type === "returning") {
    // ── Returning customers: new in previous month who came back in [from,to]
    const prevMonthEnd   = new Date(fromDate); prevMonthEnd.setUTCDate(0); prevMonthEnd.setUTCHours(23, 59, 59, 999);
    const prevMonthStart = new Date(prevMonthEnd); prevMonthStart.setUTCDate(1); prevMonthStart.setUTCHours(0, 0, 0, 0);

    // Customers who had appointments last month
    const prevAppts = await prisma.appointment.findMany({
      where: { businessId: bizId, status: { notIn: cancelledArr }, date: { gte: prevMonthStart, lte: prevMonthEnd }, ...sf },
      select: { customerId: true },
    });
    const prevCustIds = Array.from(new Set(prevAppts.map(a => a.customerId)));
    if (prevCustIds.length === 0) return NextResponse.json([]);

    // Full history for these customers
    const prevHistory = await prisma.appointment.findMany({
      where: { businessId: bizId, status: { notIn: cancelledArr }, customerId: { in: prevCustIds }, ...sf },
      select: { customerId: true, date: true },
    });

    const prevDates = new Map<string, Date[]>();
    for (const a of prevHistory) {
      const arr = prevDates.get(a.customerId) ?? [];
      arr.push(new Date(a.date));
      prevDates.set(a.customerId, arr);
    }
    prevDates.forEach(arr => arr.sort((a, b) => a.getTime() - b.getTime()));

    // Filter: first visit was in prev month
    const prevNewIds = prevCustIds.filter(id => {
      const dates = prevDates.get(id) ?? [];
      return dates[0] && dates[0] >= prevMonthStart && dates[0] <= prevMonthEnd;
    });

    // Current period customers
    const periodAppts = await prisma.appointment.findMany({
      where: { businessId: bizId, date: { gte: fromDate, lte: toDate }, status: { notIn: cancelledArr }, ...sf },
      select: { customerId: true, customer: { select: { id: true, name: true, phone: true } } },
    });
    const periodCustSet = new Set(periodAppts.map(a => a.customerId));

    const custMap = new Map<string, { name: string; phone: string }>();
    for (const a of periodAppts) {
      if (!custMap.has(a.customerId))
        custMap.set(a.customerId, { name: a.customer.name, phone: a.customer.phone });
    }

    // Also fetch names for customers not in this period (shouldn't happen, but safety)
    const missingIds = prevNewIds.filter(id => periodCustSet.has(id) && !custMap.has(id));
    if (missingIds.length > 0) {
      const extra = await prisma.customer.findMany({
        where: { id: { in: missingIds } },
        select: { id: true, name: true, phone: true },
      });
      for (const c of extra) custMap.set(c.id, { name: c.name, phone: c.phone });
    }

    const returning = prevNewIds
      .filter(id => periodCustSet.has(id))
      .map(id => {
        const c = custMap.get(id);
        return { id, name: c?.name ?? "—", phone: c?.phone ?? "" };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "he"));

    return NextResponse.json(returning);

  } else {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }
}
