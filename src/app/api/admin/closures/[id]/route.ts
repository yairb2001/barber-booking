import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwnStaffOrOwner } from "@/lib/session";
import { summarizeClosure, resendClosureNotice, markHandled } from "@/lib/closures/status";

/**
 * GET   /api/admin/closures/[id]              — live status card (per customer)
 * PATCH /api/admin/closures/[id]  { action: "resend" | "handled", appointmentId }
 * Spec: specs/calendar-closure.md §3.6
 */
async function load(req: NextRequest, id: string) {
  const session = getRequestSession(req);
  if (!session?.businessId) return { err: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const closure = await prisma.calendarClosure.findFirst({ where: { id, businessId: session.businessId } });
  if (!closure) return { err: NextResponse.json({ error: "לא נמצא" }, { status: 404 }) };
  const guard = requireOwnStaffOrOwner(req, closure.staffId);
  if (guard) return { err: guard };
  return { closure, session };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await load(req, params.id);
  if ("err" in r) return r.err;
  return NextResponse.json(await summarizeClosure(params.id));
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await load(req, params.id);
  if ("err" in r) return r.err;
  const body = await req.json().catch(() => ({}));
  const appointmentId = typeof body.appointmentId === "string" ? body.appointmentId : null;
  if (!appointmentId) return NextResponse.json({ error: "appointmentId חובה" }, { status: 400 });
  if (body.action === "resend") {
    const ok = await resendClosureNotice(params.id, appointmentId);
    return NextResponse.json({ ok });
  }
  if (body.action === "handled") {
    await markHandled(params.id, appointmentId);
    return NextResponse.json(await summarizeClosure(params.id));
  }
  return NextResponse.json({ error: "action לא מוכר" }, { status: 400 });
}
