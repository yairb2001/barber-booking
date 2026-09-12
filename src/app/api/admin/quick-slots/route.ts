import { NextRequest, NextResponse } from "next/server";
import { getRequestSession } from "@/lib/session";
import { computeQuickSlots } from "@/lib/quick-slots";

export const dynamic = "force-dynamic";

/**
 * Admin "הכי קרוב": the nearest open slots across EVERY available barber (or
 * one barber with ?staffId=), for the barber on the phone with a customer.
 * No lead-time restriction — the barber decides.
 */
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const staffId = req.nextUrl.searchParams.get("staffId");
  const slots = await computeQuickSlots({
    businessId: session.businessId,
    staffIdFilter: staffId || null,
    allStaff: true,
    leadOverride: 0,
    perBarber: 4,
  });
  return NextResponse.json(slots.slice(0, 14));
}
