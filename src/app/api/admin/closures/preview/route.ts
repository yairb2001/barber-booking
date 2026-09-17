import { NextRequest, NextResponse } from "next/server";
import { getRequestSession, requireOwnStaffOrOwner } from "@/lib/session";
import { planClosure } from "@/lib/closures/plan";

/**
 * POST /api/admin/closures/preview  { staffId, date: "YYYY-MM-DD", fromTime?, toTime? }
 *
 * Read-only. Returns the closure plan: which appointments fall in the window,
 * the two best alternatives per customer, the capacity gate, and one-click
 * fix suggestions when the gate is blocked. A barber may preview their own
 * calendar; the owner any. Spec: specs/calendar-closure.md §3.3
 */
export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session?.businessId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const staffId = typeof body.staffId === "string" ? body.staffId : null;
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  const t = (v: unknown) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : null);
  if (!staffId || !date) return NextResponse.json({ error: "staffId ו-date חובה" }, { status: 400 });
  const guard = requireOwnStaffOrOwner(req, staffId);
  if (guard) return guard;
  try {
    const plan = await planClosure({ businessId: session.businessId, staffId, date, fromTime: t(body.fromTime), toTime: t(body.toTime) });
    return NextResponse.json(plan);
  } catch (e) {
    if ((e as Error).message === "staff_not_found") return NextResponse.json({ error: "ספר לא נמצא" }, { status: 404 });
    console.error("[closures/preview]", e);
    return NextResponse.json({ error: "preview_failed" }, { status: 500 });
  }
}
