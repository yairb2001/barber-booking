import { NextResponse } from "next/server";
import { resolveBusinessId } from "@/lib/tenant";
import { sessionsBetween } from "@/lib/classes";
import { addDaysISO, getBusinessNow } from "@/lib/utils";

/** Public: the coming sessions of a business with spots left (no names). */
export async function GET(request: Request) {
  const businessId = await resolveBusinessId(request);
  if (!businessId) return NextResponse.json({ sessions: [] });
  const { searchParams } = new URL(request.url);
  const now = getBusinessNow();
  const from = searchParams.get("from") || now.date;
  const to = searchParams.get("to") || addDaysISO(from, 13);
  const rows = await sessionsBetween(businessId, from, to);
  const future = rows.filter(r => r.date > now.date || (r.date === now.date && r.startTime > now.time));
  return NextResponse.json({
    sessions: future.map(r => ({ id: r.id, name: r.name, description: r.description, price: r.price, date: r.date, startTime: r.startTime, endTime: r.endTime, staffName: r.staffName, left: Math.max(0, r.capacity - r.booked), waiting: r.waiting })),
  });
}
