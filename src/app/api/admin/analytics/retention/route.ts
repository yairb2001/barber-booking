/**
 * GET /api/admin/analytics/retention?staffId=
 *
 * New customers in the last 30 / 60 / 90 days and how many came back for a
 * second visit — counted from appointments that actually happened, never from
 * Customer.createdAt (see src/lib/analytics/retention.ts for the definitions).
 * Barbers get their own numbers; the owner may filter by staffId.
 */
import { NextRequest, NextResponse } from "next/server";
import { getRequestSession, getSessionBusiness } from "@/lib/session";
import { computeRetention } from "@/lib/analytics/retention";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const biz = await getSessionBusiness(req, { id: true });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });
  const requested = req.nextUrl.searchParams.get("staffId") || null;
  const staffId = (!session.isOwner && session.staffId) ? session.staffId : requested;
  const result = await computeRetention({ businessId: biz.id, staffId });
  return NextResponse.json(result);
}
