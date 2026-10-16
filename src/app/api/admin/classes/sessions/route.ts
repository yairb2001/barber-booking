import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";
import { sessionsBetween } from "@/lib/classes";
import { addDaysISO, getBusinessNow } from "@/lib/utils";

/** The sessions of a range with who is in them (group classes, 16.10.2026). */
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const today = getBusinessNow().date;
  const from = req.nextUrl.searchParams.get("from") || today;
  const to = req.nextUrl.searchParams.get("to") || addDaysISO(from, 6);
  const rows = await sessionsBetween(session.businessId, from, to, { includeCancelled: true });
  const people = await prisma.classBooking.findMany({
    where: { sessionId: { in: rows.map(r => r.id) }, status: { in: ["booked", "waitlist", "attended", "no_show"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, sessionId: true, status: true, customer: { select: { id: true, name: true, phone: true } } },
  });
  return NextResponse.json(rows.map(r => ({ ...r, people: people.filter(p => p.sessionId === r.id).map(p => ({ bookingId: p.id, status: p.status, ...p.customer })) })));
}
