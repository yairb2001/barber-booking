import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";

/**
 * GET /api/admin/staff/departed
 *
 * Owner-only. Returns soft-deleted (isActive:false) staff, each with their
 * LAST appointment (date/startTime) — powers the calendar's "show departed
 * barbers" toggle, which needs to jump straight to the last date they
 * actually worked instead of "today" (where a departed barber has nothing
 * to show — DELETE /api/admin/staff/[id] refuses to soft-delete a barber
 * with open future appointments, so their last appointment is always in
 * the past).
 */
export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;

  const staff = await prisma.staff.findMany({
    where: { isActive: false, businessId: session.businessId },
    include: {
      schedules: true,
      appointments: {
        orderBy: [{ date: "desc" }, { startTime: "desc" }],
        take: 1,
        select: { id: true, date: true, startTime: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(staff.map(s => ({
    ...s,
    lastAppointment: s.appointments[0] ?? null,
    appointments: undefined,
  })));
}
