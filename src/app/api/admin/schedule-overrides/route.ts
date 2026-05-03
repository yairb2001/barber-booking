import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

/**
 * GET /api/admin/schedule-overrides?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Returns all schedule overrides for the business's staff within the date range.
 * Used by the calendar to show day-specific closures/hour changes visually.
 */
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session?.businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get("startDate");
  const endDate   = searchParams.get("endDate");

  if (!startDate || !endDate) return NextResponse.json([]);

  const start = new Date(startDate + "T00:00:00.000Z");
  const end   = new Date(endDate   + "T23:59:59.999Z");

  // Scope to this business's staff only
  const overrides = await prisma.staffScheduleOverride.findMany({
    where: {
      staff: { businessId: session.businessId },
      date: { gte: start, lte: end },
      // Barbers only see their own overrides
      ...(session.isOwner ? {} : { staffId: session.staffId }),
    },
    select: {
      staffId: true,
      date:    true,
      isWorking: true,
      slots:   true,
      breaks:  true,
    },
  });

  // Return dates as YYYY-MM-DD strings for easy client-side lookup
  const result = overrides.map(o => ({
    staffId:   o.staffId,
    date:      o.date.toISOString().split("T")[0],
    isWorking: o.isWorking,
    slots:     o.slots,
    breaks:    o.breaks,
  }));

  return NextResponse.json(result);
}
