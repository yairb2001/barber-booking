import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  buildDailyReport,
  buildDailyReportStaff,
  buildWeeklyReportManager,
  buildWeeklyReportStaff,
  buildMonthlyReportManager,
  buildMonthlyReportStaff,
} from "@/lib/messaging/reports";

/**
 * GET /api/admin/reports/preview?kind=daily|weekly|monthly&scope=owner|staff
 *
 * Builds the report against live data and returns the TEXT — it never sends a
 * WhatsApp message, so the owner can see exactly what a switch turns on before
 * committing to it. For scope=staff it uses the first available barber as the
 * example.
 */
export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const business = await getSessionBusiness(req, { id: true });
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  const kind = req.nextUrl.searchParams.get("kind") || "daily";
  const scope = req.nextUrl.searchParams.get("scope") === "staff" ? "staff" : "owner";

  if (!["daily", "weekly", "monthly"].includes(kind)) {
    return NextResponse.json({ error: "bad kind" }, { status: 400 });
  }

  try {
    if (scope === "owner") {
      const body =
        kind === "daily" ? await buildDailyReport(business.id)
        : kind === "weekly" ? await buildWeeklyReportManager(business.id)
        : await buildMonthlyReportManager(business.id);
      return NextResponse.json({ body });
    }

    const staff = await prisma.staff.findFirst({
      where: { businessId: business.id, isAvailable: true, phone: { not: null } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    });
    if (!staff) return NextResponse.json({ error: "אין ספר פעיל עם טלפון להצגת דוגמה" }, { status: 404 });

    const body =
      kind === "daily" ? await buildDailyReportStaff(business.id, staff.id)
      : kind === "weekly" ? await buildWeeklyReportStaff(business.id, staff.id)
      : await buildMonthlyReportStaff(business.id, staff.id);
    return NextResponse.json({ body, sampleStaff: staff.name });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה בבניית הדוח" },
      { status: 500 },
    );
  }
}
