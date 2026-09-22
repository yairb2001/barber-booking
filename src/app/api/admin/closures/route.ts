import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwnStaffOrOwner } from "@/lib/session";
import { executeClosure, closeHoursSilently } from "@/lib/closures/execute";
import { summarizeClosure } from "@/lib/closures/status";

/**
 * POST /api/admin/closures — execute a closure the barber approved in the wizard.
 * Body: { staffId, date, fromTime?, toTime?, reason?, excludeAppointmentIds?,
 *         customTextByAppointmentId?, templateOverride?, saveTemplate? }
 * GET  /api/admin/closures?status=active — the barber's open closures (owner: all).
 * Spec: specs/calendar-closure.md §3.4, §3.6
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

  // Optional: persist an edited wording as the business template for next time.
  if (body.saveTemplate === true && typeof body.templateOverride === "string" && body.templateOverride.trim()) {
    await prisma.business.update({ where: { id: session.businessId }, data: { closureNoticeTemplate: body.templateOverride.trim() } }).catch(() => {});
  }
  // silent: block the hours only — no cancellations, no messages, no closure card.
  if (body.silent === true) {
    await closeHoursSilently({ businessId: session.businessId, staffId, date, fromTime: t(body.fromTime), toTime: t(body.toTime) }, typeof body.reason === "string" ? body.reason.slice(0, 200) : null);
    return NextResponse.json({ ok: true, silent: true });
  }
  try {
    const result = await executeClosure(
      { businessId: session.businessId, staffId, date, fromTime: t(body.fromTime), toTime: t(body.toTime) },
      {
        reason: typeof body.reason === "string" ? body.reason.slice(0, 200) : null,
        createdByStaffId: session.staffId ?? null,
        excludeAppointmentIds: Array.isArray(body.excludeAppointmentIds) ? body.excludeAppointmentIds.filter((x: unknown) => typeof x === "string") : [],
        customTextByAppointmentId: body.customTextByAppointmentId && typeof body.customTextByAppointmentId === "object" ? body.customTextByAppointmentId : undefined,
        templateOverride: typeof body.templateOverride === "string" ? body.templateOverride : null,
      },
    );
    return NextResponse.json(result);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "gate_blocked") return NextResponse.json({ error: "אין מספיק חלופות פנויות — בדוק שוב את התצוגה המקדימה" }, { status: 409 });
    if (msg === "staff_not_found") return NextResponse.json({ error: "ספר לא נמצא" }, { status: 404 });
    console.error("[closures] execute failed", e);
    return NextResponse.json({ error: "closure_failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session?.businessId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const status = new URL(req.url).searchParams.get("status") ?? "active";
  const rows = await prisma.calendarClosure.findMany({
    where: { businessId: session.businessId, status, ...(session.isOwner ? {} : { staffId: session.staffId ?? "" }) },
    orderBy: { createdAt: "desc" }, take: 20,
  });
  const out = await Promise.all(rows.map(r => summarizeClosure(r.id)));
  return NextResponse.json(out.filter(Boolean));
}
