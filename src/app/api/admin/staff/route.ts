import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner, getRequestSession } from "@/lib/session";
import { getBusinessNow } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);

  // Default: barbers see only themselves. Exception: if canViewAllCalendars is set.
  let where: { id: string } | undefined = undefined;
  if (session && !session.isOwner && session.staffId) {
    const me = await prisma.staff.findUnique({
      where: { id: session.staffId },
      select: { canViewAllCalendars: true },
    });
    if (!me?.canViewAllCalendars) {
      where = { id: session.staffId };
    }
    // canViewAllCalendars=true → where stays undefined → sees all staff
  }

  // Current business time (Israel timezone)
  const { date: todayStr, time: nowTime } = getBusinessNow();
  const todayDate = new Date(todayStr + "T00:00:00.000Z");

  const staff = await prisma.staff.findMany({
    ...(where ? { where } : {}),
    include: {
      schedules: true,
      staffServices: { include: { service: true } },
      appointments: {
        where: {
          status: { in: ["pending", "confirmed"] },
          OR: [
            { date: { gt: todayDate } },
            { date: todayDate, startTime: { gte: nowTime } },
          ],
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        take: 1,
        select: { id: true, date: true, startTime: true },
      },
    },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(staff);
}

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const body = await req.json();
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  const staff = await prisma.staff.create({
    data: {
      businessId: business.id,
      name: body.name,
      phone: body.phone || null,
      avatarUrl: body.avatarUrl || null,
      role: body.role || "barber",
      isAvailable: body.isAvailable ?? true,
      inQuickPool: body.inQuickPool ?? false,
      sortOrder: body.sortOrder ?? 0,
    },
  });
  return NextResponse.json(staff, { status: 201 });
}
