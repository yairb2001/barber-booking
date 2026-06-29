import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness, requireOwner } from "@/lib/session";
import { getBusinessNow } from "@/lib/utils";

export async function GET(req: NextRequest) {
  // All authenticated users (owners + barbers) see all staff.
  // Barbers work in a shared calendar — they need all columns.
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Current business time (Israel timezone)
  const { date: todayStr, time: nowTime } = getBusinessNow();
  const todayDate = new Date(todayStr + "T00:00:00.000Z");

  const staff = await prisma.staff.findMany({
    where: { isActive: true, businessId: session.businessId },
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
  const business = await getSessionBusiness(req);
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
