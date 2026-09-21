import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getEffectivePermissions, getSessionBusiness } from "@/lib/session";
import { providerForBusiness } from "@/lib/messaging";

// POST /api/admin/chats/[id]/send-voice — a voice note recorded in the admin
// (OGG/Opus from the browser) → our storage → WhatsApp as a native voice
// message (Green API sends .ogg as PTT). Mirrors the manual text send: recorded
// in the thread as source "admin" and mutes the agent for 24h.
const MAX_BYTES = 16 * 1024 * 1024;
const VOICE_LABEL = "🎤 הודעה קולית";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const business = await getSessionBusiness(req, { id: true, chatsEnabled: true });
  if (!business?.chatsEnabled) return NextResponse.json({ error: "feature_disabled" }, { status: 403 });
  const perms = await getEffectivePermissions(req);
  if (!perms.isOwner && !perms.canViewAllChats) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file || !file.size) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large" }, { status: 413 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: "storage not configured" }, { status: 500 });

  const conv = await prisma.conversation.findFirst({ where: { id: params.id, businessId: business.id } });
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });

  const biz = await prisma.business.findUnique({ where: { id: business.id }, select: { messagingProvider: true, whatsappNumber: true, greenApiInstanceId: true, greenApiToken: true } });
  const provider = biz ? providerForBusiness(biz) : null;
  if (!provider?.sendFileByUrl) return NextResponse.json({ error: "provider cannot send files" }, { status: 500 });

  const buf = Buffer.from(await file.arrayBuffer());
  const key = `wa-media/out/${business.id}/${crypto.randomUUID()}.ogg`;
  const blob = await put(key, buf, { access: "public", addRandomSuffix: false, contentType: "audio/ogg" });

  const result = await provider.sendFileByUrl(conv.phone, { urlFile: blob.url, fileName: `voice-${Date.now()}.ogg` });
  await prisma.messageLog.create({
    data: { businessId: business.id, customerPhone: conv.phone, kind: "manual", body: VOICE_LABEL, status: result.ok ? "sent" : "failed", providerId: result.providerId ?? null, sentAt: result.ok ? new Date() : null },
  }).catch(() => {});
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error || "send failed" }, { status: 502 });

  const saved = await prisma.conversationMessage.create({
    data: { conversationId: conv.id, role: "assistant", source: "admin", sentByStaffId: session.staffId ?? null, content: VOICE_LABEL, mediaUrl: blob.url, mediaType: "audio", mediaMime: "audio/ogg" },
  });
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { escalatedAt: new Date(), lastMessageAt: new Date(), lastReadAt: new Date(), snoozedUntil: null },
  });
  return NextResponse.json({ ok: true, message: { id: saved.id, role: saved.role, source: saved.source, content: saved.content, createdAt: saved.createdAt, mediaUrl: saved.mediaUrl, mediaType: saved.mediaType, mediaMime: saved.mediaMime } });
}
