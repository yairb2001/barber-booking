import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveBusinessId } from "@/lib/tenant";
import { shownNotice } from "@/lib/booking-notice";

export const dynamic = "force-dynamic";

/**
 * Public: the booking flow's "הודעה חשובה" popups (src/lib/booking-notice.ts).
 * { general: string | null, staff: { [staffId]: string } } — only notices that are on.
 */
export async function GET(req: NextRequest) {
  const businessId = await resolveBusinessId(req);
  if (!businessId) return NextResponse.json({ general: null, staff: {} });
  const [biz, staff] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { settings: true } }),
    prisma.staff.findMany({ where: { businessId, isActive: true }, select: { id: true, settings: true } }),
  ]);
  const byStaff: Record<string, string> = {};
  for (const s of staff) { const t = shownNotice(s.settings); if (t) byStaff[s.id] = t; }
  return NextResponse.json({ general: shownNotice(biz?.settings), staff: byStaff });
}
