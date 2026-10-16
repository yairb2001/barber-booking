import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { resolveBusinessId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Resolve which business to scope to from ?slug= / ?businessId=
  // (no param → root business). null = param supplied but unmatched → empty.
  const resolvedBusinessId = await resolveBusinessId(req);
  if (!resolvedBusinessId) return NextResponse.json([]);

  // Treatment first (16.10.2026): ?serviceId= → only the people who do it.
  const serviceId = req.nextUrl.searchParams.get("serviceId");
  const staff = await prisma.staff.findMany({
    where: { isAvailable: true, isActive: true, businessId: resolvedBusinessId, ...(serviceId ? { staffServices: { some: { serviceId } } } : {}) },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      nickname: true,
      tagline: true,
      avatarUrl: true,
      role: true,
      isAvailable: true,
      inQuickPool: true,
      settings: true,
      portfolio: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          imageUrl: true,
          caption: true,
        },
      },
      staffServices: serviceId
        ? { where: { serviceId }, select: { serviceId: true, customPrice: true, customDuration: true, service: { select: { price: true, durationMinutes: true } } } }
        : { take: 1, select: { serviceId: true, customPrice: true, customDuration: true, service: { select: { price: true, durationMinutes: true } } } },
    },
  });

  // Only expose staff who have at least one service assigned
  const staffWithServices = staff.filter(s => s.staffServices.length > 0);

  // Expose per-barber booking config as parsed fields (fall back to null if not set)
  const result = staffWithServices.map(s => {
    let bookingConfig: Record<string, unknown> = {};
    try { if (s.settings) bookingConfig = JSON.parse(s.settings); } catch { /* ignore */ }
    const forService = serviceId ? s.staffServices[0] : null;
    return {
      ...s,
      // With ?serviceId: this person's own price and duration for that treatment.
      ...(forService ? { servicePrice: forService.customPrice ?? forService.service.price, serviceDuration: forService.customDuration ?? forService.service.durationMinutes } : {}),
      staffServices: undefined, // don't expose
      settings: undefined, // don't expose raw JSON
      bookingHorizonDays:    bookingConfig.bookingHorizonDays    ?? null,
      minBookingLeadMinutes: bookingConfig.minBookingLeadMinutes ?? null,
    };
  });

  return NextResponse.json(result);
}
