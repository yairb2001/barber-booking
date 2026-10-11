import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";
import { readNotice, cleanNotice, withNotice } from "@/lib/booking-notice";

export const dynamic = "force-dynamic";

/**
 * The "הודעה חשובה" settings (src/lib/booking-notice.ts). The owner edits the
 * general notice and every barber's; a barber edits only his own.
 * GET → { isOwner, general?, staff: [{ id, name, avatarUrl, text, on }] }
 * PUT { general?: {text,on}, staff?: [{ id, text, on }] }
 */
export async function GET(req: NextRequest) {
  const s = getRequestSession(req);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const isOwner = s.isOwner;
  if (!isOwner && !s.staffId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const [biz, staff] = await Promise.all([
    isOwner ? prisma.business.findUnique({ where: { id: s.businessId }, select: { settings: true } }) : null,
    prisma.staff.findMany({ where: { businessId: s.businessId, isActive: true, ...(isOwner ? {} : { id: s.staffId }) }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, avatarUrl: true, settings: true } }),
  ]);
  return NextResponse.json({
    isOwner,
    general: isOwner ? readNotice(biz?.settings) : undefined,
    staff: staff.map(m => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl, ...readNotice(m.settings) })),
  });
}

export async function PUT(req: NextRequest) {
  const s = getRequestSession(req);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!s.isOwner && !s.staffId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({})) as { general?: unknown; staff?: { id?: unknown; text?: unknown; on?: unknown }[] };
  if (body.general !== undefined) {
    if (!s.isOwner) return NextResponse.json({ error: "רק בעל העסק יכול לשנות את ההודעה הכללית" }, { status: 403 });
    const biz = await prisma.business.findUnique({ where: { id: s.businessId }, select: { settings: true } });
    await prisma.business.update({ where: { id: s.businessId }, data: { settings: withNotice(biz?.settings, cleanNotice(body.general)) } });
  }
  for (const row of Array.isArray(body.staff) ? body.staff : []) {
    const id = typeof row.id === "string" ? row.id : "";
    if (!id || (!s.isOwner && id !== s.staffId)) continue; // a barber: only himself
    const m = await prisma.staff.findFirst({ where: { id, businessId: s.businessId }, select: { settings: true } });
    if (!m) continue;
    await prisma.staff.update({ where: { id }, data: { settings: withNotice(m.settings, cleanNotice(row)) } });
  }
  return NextResponse.json({ ok: true });
}
