import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get("businessId");

  // Resolve which business to scope to (backward-compat: no param → findFirst)
  let resolvedBusinessId: string | undefined;
  if (businessId) {
    resolvedBusinessId = businessId;
  } else {
    const biz = await prisma.business.findFirst({ select: { id: true } });
    resolvedBusinessId = biz?.id;
  }

  const staff = await prisma.staff.findMany({
    where: { isAvailable: true, ...(resolvedBusinessId ? { businessId: resolvedBusinessId } : {}) },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      nickname: true,
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
      staffServices: { take: 1, select: { serviceId: true } },
    },
  });

  // Only expose staff who have at least one service assigned
  const staffWithServices = staff.filter(s => s.staffServices.length > 0);

  // Expose per-barber booking config as parsed fields (fall back to null if not set)
  const result = staffWithServices.map(s => {
    let bookingConfig: Record<string, unknown> = {};
    try { if (s.settings) bookingConfig = JSON.parse(s.settings); } catch { /* ignore */ }
    return {
      ...s,
      staffServices: undefined, // don't expose
      settings: undefined, // don't expose raw JSON
      bookingHorizonDays:    bookingConfig.bookingHorizonDays    ?? null,
      minBookingLeadMinutes: bookingConfig.minBookingLeadMinutes ?? null,
    };
  });

  return NextResponse.json(result);
}
