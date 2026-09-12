import { NextRequest, NextResponse } from "next/server";
import { getRequestSession } from "@/lib/session";
import { computeDayAvailability } from "@/lib/agent/availability";

export const dynamic = "force-dynamic";

/**
 * Admin availability for one barber on one day — same truth as the website
 * and the agent (schedule, overrides, breaks, bookings) but WITHOUT the
 * customer-facing horizon / lead-time limits: a barber may book any free time.
 * GET ?staffId=&date=YYYY-MM-DD&serviceId=
 */
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const staffId = sp.get("staffId") || "";
  const date = sp.get("date") || "";
  const serviceId = sp.get("serviceId") || undefined;
  if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const rows = await computeDayAvailability(session.businessId, date, staffId, serviceId, { ignoreLimits: true });
  return NextResponse.json({ slots: rows.find(r => r.staffId === staffId)?.slots ?? [] });
}
