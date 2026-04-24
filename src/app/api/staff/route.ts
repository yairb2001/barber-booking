import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const staff = await prisma.staff.findMany({
    where: { isAvailable: true },
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
    },
  });

  // Expose per-barber booking config as parsed fields (fall back to null if not set)
  const result = staff.map(s => {
    let bookingConfig: Record<string, unknown> = {};
    try { if (s.settings) bookingConfig = JSON.parse(s.settings); } catch { /* ignore */ }
    return {
      ...s,
      settings: undefined, // don't expose raw JSON
      bookingHorizonDays:    bookingConfig.bookingHorizonDays    ?? null,
      minBookingLeadMinutes: bookingConfig.minBookingLeadMinutes ?? null,
    };
  });

  return NextResponse.json(result);
}
