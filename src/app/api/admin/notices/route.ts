import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";
import { readNotice, readPending, cleanNotice, withNotice, withPending } from "@/lib/booking-notice";
import { centerNotify } from "@/lib/notify/center";

export const dynamic = "force-dynamic";

/**
 * The "הודעה חשובה" settings (src/lib/booking-notice.ts). The owner edits the
 * general notice and every barber's, live at once. A barber edits only his
 * own, and a new or changed text waits for the owner's approval (11.10.2026);
 * turning his notice off is immediate (nothing new reaches customers).
 * GET  → { isOwner, general?, staff: [{ id, name, avatarUrl, text, on, pending }] }
 * PUT  { general?: {text,on}, staff?: [{ id, text, on }] } → { ok, pending? }
 * POST { action: "approve" | "reject", staffId } (owner)
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
    staff: staff.map(m => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl, ...readNotice(m.settings), pending: readPending(m.settings) })),
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
  let pending = false;
  for (const row of Array.isArray(body.staff) ? body.staff : []) {
    const id = typeof row.id === "string" ? row.id : "";
    if (!id || (!s.isOwner && id !== s.staffId)) continue; // a barber: only himself
    const m = await prisma.staff.findFirst({ where: { id, businessId: s.businessId }, select: { name: true, settings: true } });
    if (!m) continue;
    const next = cleanNotice(row);
    const live = readNotice(m.settings);
    if (s.isOwner) {
      // Saving the page sends every row: an untouched barber keeps his request waiting.
      if (live.text === next.text && live.on === next.on) continue;
      await prisma.staff.update({ where: { id }, data: { settings: withNotice(m.settings, next) } });
      continue;
    }
    if (!next.on || !next.text.trim()) {
      // Off: straight away, and any proposal is dropped.
      await prisma.staff.update({ where: { id }, data: { settings: withNotice(m.settings, { text: next.text, on: false }) } });
      continue;
    }
    if (live.on && live.text.trim() === next.text.trim()) { await prisma.staff.update({ where: { id }, data: { settings: withNotice(m.settings, live) } }); continue; }
    await prisma.staff.update({ where: { id }, data: { settings: withPending(m.settings, { ...next, at: new Date().toISOString() }) } });
    pending = true;
    await centerNotify({
      businessId: s.businessId, kind: "team",
      title: `${m.name} מבקש לפרסם הודעה ללקוחות`,
      body: next.text.slice(0, 300),
      href: "/admin/settings/notices",
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, ...(pending ? { pending: true } : {}) });
}

export async function POST(req: NextRequest) {
  const s = getRequestSession(req);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!s.isOwner) return NextResponse.json({ error: "רק בעל העסק מאשר הודעות" }, { status: 403 });
  const body = await req.json().catch(() => ({})) as { action?: string; staffId?: string };
  const m = await prisma.staff.findFirst({ where: { id: String(body.staffId ?? ""), businessId: s.businessId }, select: { id: true, settings: true } });
  const p = m ? readPending(m.settings) : null;
  if (!m || !p) return NextResponse.json({ error: "אין הודעה שמחכה לאישור" }, { status: 404 });
  if (body.action === "approve") {
    await prisma.staff.update({ where: { id: m.id }, data: { settings: withNotice(m.settings, { text: p.text, on: p.on }) } });
    await centerNotify({ businessId: s.businessId, staffId: m.id, kind: "team", title: "ההודעה שלך ללקוחות אושרה", body: "מעכשיו היא קופצת ללקוחות שבוחרים בך.", href: "/admin/barber-settings/notice" }).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  if (body.action === "reject") {
    await prisma.staff.update({ where: { id: m.id }, data: { settings: withNotice(m.settings, readNotice(m.settings)) } });
    await centerNotify({ businessId: s.businessId, staffId: m.id, kind: "team", title: "המנהל לא אישר את ההודעה שלך", body: "אפשר לנסח אחרת ולשלוח שוב.", href: "/admin/barber-settings/notice" }).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
}
