import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyWaitlistForDayOpen } from "@/lib/waitlist-notify";
import { requireOwnStaffOrOwner } from "@/lib/session";

/**
 * POST /api/admin/staff/[id]/schedule/notify-waitlist
 * Body: { date: "YYYY-MM-DD" }
 *
 * On-demand waitlist notification, fired only after the manager explicitly
 * confirms ("להודיע לרשימת ההמתנה?") following a schedule change that expanded
 * availability (break removed / hours extended / day re-opened).
 *
 * Notifies all "waiting" entries for this staff (or any-barber) on that date.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwnStaffOrOwner(req, params.id);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  if (!body.date) {
    return NextResponse.json({ error: "date required" }, { status: 400 });
  }
  const date = new Date(String(body.date).split("T")[0] + "T00:00:00.000Z");

  const staff = await prisma.staff.findUnique({
    where: { id: params.id },
    select: { businessId: true },
  });
  if (!staff) return NextResponse.json({ error: "staff not found" }, { status: 404 });

  await notifyWaitlistForDayOpen({
    businessId: staff.businessId,
    staffId:    params.id,
    date,
  });

  return NextResponse.json({ ok: true });
}
