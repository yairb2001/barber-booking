/**
 * GET /api/admin/analytics/today
 *
 * Drill-down lists for the "⚡ היום" dashboard tiles. Mirrors the exact
 * today-boundary + status-filter + staff-scoping logic used to compute
 * todayNewToBusiness / todayAppointments / bookingsCreatedToday in
 * /api/admin/analytics/route.ts — counts here must always match those.
 *
 * Params:
 *   kind      "new" | "appointments" | "booked"
 *   staffId?  filter to one barber
 *   date?     YYYY-MM-DD — defaults to (and is clamped to) today
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
  const kind    = searchParams.get("kind") ?? "";
  const staffId = searchParams.get("staffId") || null;
  const dateStr = searchParams.get("date") || "";

  const effectiveStaffId = (!session.isOwner && session.staffId)
    ? session.staffId
    : staffId;

  const sf = effectiveStaffId ? { staffId: effectiveStaffId } : {};
  const cancelledArr = Array.from(CANCELLED);

  // Same clamp-to-real-today rule as /api/admin/analytics, so the drill-down
  // list always matches whichever day the "⚡ [date]" snapshot is showing.
  const realTodayStart = new Date(); realTodayStart.setUTCHours(0, 0, 0, 0);
  const parsedDate = dateStr ? new Date(dateStr + "T00:00:00.000Z") : null;
  const todayStart = (parsedDate && !isNaN(parsedDate.getTime()) && parsedDate <= realTodayStart)
    ? parsedDate
    : realTodayStart;
  const todayEnd = new Date(todayStart); todayEnd.setUTCHours(23, 59, 59, 999);

  if (kind === "appointments") {
    const todayAppts = await prisma.appointment.findMany({
      where: {
        businessId: bizId,
        date: { gte: todayStart, lte: todayEnd },
        status: { notIn: cancelledArr },
        ...sf,
      },
      select: {
        id: true, startTime: true,
        customer: { select: { id: true, name: true, phone: true } },
        staff:    { select: { id: true, name: true } },
      },
      orderBy: { startTime: "asc" },
    });
    return NextResponse.json(todayAppts.map(a => ({
      id: a.id,
      name: a.customer.name,
      phone: a.customer.phone,
      startTime: a.startTime,
      staffName: a.staff.name,
    })));
  }

  if (kind === "booked") {
    const bookedAppts = await prisma.appointment.findMany({
      where: {
        businessId: bizId,
        createdAt: { gte: todayStart, lte: todayEnd },
        status: { notIn: cancelledArr },
        ...sf,
      },
      select: {
        id: true, date: true, startTime: true, createdAt: true,
        customer: { select: { id: true, name: true, phone: true } },
        staff:    { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(bookedAppts.map(a => ({
      id: a.id,
      name: a.customer.name,
      phone: a.customer.phone,
      staffName: a.staff.name,
      apptDate: a.date.toISOString().slice(0, 10),
      startTime: a.startTime,
      createdAt: a.createdAt.toISOString(),
    })));
  }

  if (kind === "new") {
    const todayAppts = await prisma.appointment.findMany({
      where: {
        businessId: bizId,
        date: { gte: todayStart, lte: todayEnd },
        status: { notIn: cancelledArr },
        ...sf,
      },
      select: {
        id: true, customerId: true,
        customer: { select: { id: true, name: true, phone: true } },
        staff:    { select: { id: true, name: true } },
      },
    });
    const todayCustIds = Array.from(new Set(todayAppts.map(a => a.customerId)));
    if (todayCustIds.length === 0) return NextResponse.json([]);

    const todayHistory = await prisma.appointment.findMany({
      where: { businessId: bizId, status: { notIn: cancelledArr }, customerId: { in: todayCustIds } },
      select: { customerId: true, date: true },
    });
    const tDates = new Map<string, Date[]>();
    for (const a of todayHistory) {
      const arr = tDates.get(a.customerId) ?? [];
      arr.push(new Date(a.date));
      tDates.set(a.customerId, arr);
    }
    tDates.forEach(arr => arr.sort((a, b) => a.getTime() - b.getTime()));

    const custMap = new Map<string, { name: string; phone: string; staffName: string }>();
    for (const a of todayAppts) {
      if (!custMap.has(a.customerId))
        custMap.set(a.customerId, { name: a.customer.name, phone: a.customer.phone, staffName: a.staff.name });
    }

    const newToday = todayCustIds
      .filter(cid => {
        const d0 = tDates.get(cid)?.[0];
        return d0 && d0 >= todayStart && d0 <= todayEnd;
      })
      .map(cid => {
        const c = custMap.get(cid)!;
        return { id: cid, name: c.name, phone: c.phone, staffName: c.staffName };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "he"));

    return NextResponse.json(newToday);
  }

  return NextResponse.json({ error: "invalid kind" }, { status: 400 });
}
