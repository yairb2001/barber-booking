import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";
import { CENTER_KINDS, channelFor, type Channel } from "@/lib/notify/kinds";

export const dynamic = "force-dynamic";

/**
 * Each person's choice, per kind of notification, of how it reaches them:
 * push, WhatsApp or only the notification center (10.10.2026). The owner's
 * choices live in Business.settings.notifChannels, a barber's in his
 * Staff.settings.notifChannels.
 */
const parse = (raw: string | null | undefined): Record<string, unknown> => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };

async function load(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return null;
  if (session.isOwner || !session.staffId) {
    const b = await prisma.business.findUnique({ where: { id: session.businessId }, select: { settings: true } });
    return { session, raw: b?.settings ?? null, save: (s: string) => prisma.business.update({ where: { id: session.businessId }, data: { settings: s } }) };
  }
  const st = await prisma.staff.findUnique({ where: { id: session.staffId }, select: { settings: true } });
  return { session, raw: st?.settings ?? null, save: (s: string) => prisma.staff.update({ where: { id: session.staffId! }, data: { settings: s } }) };
}

export async function GET(req: NextRequest) {
  const ctx = await load(req);
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ kinds: CENTER_KINDS.map(k => ({ ...k, channel: channelFor(ctx.raw, k.kind) })) });
}

export async function POST(req: NextRequest) {
  const ctx = await load(req);
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const kind = CENTER_KINDS.find(k => k.kind === body.kind);
  const ch = body.channel as Channel;
  if (!kind || !["push", "whatsapp", "screen"].includes(ch) || (ch === "whatsapp" && !kind.whatsapp)) return NextResponse.json({ error: "בחירה לא תקינה" }, { status: 400 });
  const s = parse(ctx.raw);
  s.notifChannels = { ...((s.notifChannels ?? {}) as Record<string, string>), [kind.kind]: ch };
  // The escalation push (pushChatEvent) predates the center and reads this toggle.
  if (kind.kind === "escalation") s.notifyOnEscalation = ch !== "screen";
  await ctx.save(JSON.stringify(s));
  return NextResponse.json({ ok: true });
}
