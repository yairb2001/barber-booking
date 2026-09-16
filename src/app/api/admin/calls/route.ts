import { NextRequest, NextResponse } from "next/server";
import { getRequestSession } from "@/lib/session";
import { listCalls } from "@/lib/automations/call-events";
import { getBusinessNow } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** GET /api/admin/calls?date=YYYY-MM-DD — the day's calls with what happened after each. */
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const date = req.nextUrl.searchParams.get("date") || getBusinessNow().date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "bad date" }, { status: 400 });
  const rows = await listCalls(session.businessId, date);
  return NextResponse.json(rows);
}
