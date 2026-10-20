import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/super-admin";
import { providerForBusiness } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";

/**
 * POST /api/admin/crm/voice: a voice note Yair recorded in the CRM (20.10.2026,
 * "אופציה להקליט להודעות בווצאפ"), sent from Chator's line as a real WhatsApp
 * voice note. Form: file (OGG/Opus from VoiceComposer), to = lead | customer |
 * chat, id. Same as a typed message from the card: it shows in the thread as
 * his, and it quiets the sales agent for 24 hours.
 */
const MAX_BYTES = 16 * 1024 * 1024;
const VOICE_LABEL = "🎤 הודעה קולית";

const ownerPhoneOf = (b: { phone: string | null; settings: string | null }): string | null => {
  try { const s = b.settings ? JSON.parse(b.settings) : {}; return s.ownerLoginPhone || b.phone || null; } catch { return b.phone; }
};

export async function POST(req: NextRequest) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const to = String(form.get("to") ?? "");
  const id = String(form.get("id") ?? "");
  if (!file || !file.size) return NextResponse.json({ error: "ההקלטה ריקה" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "ההקלטה ארוכה מדי" }, { status: 413 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: "אין אחסון לקבצים" }, { status: 500 });

  // Who it goes to, and the conversation it is kept in.
  let phone = "";
  let conversationId: string | null = null;
  let leadId: string | null = null;
  if (to === "lead") {
    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, phone: true, stage: true } });
    if (!lead) return NextResponse.json({ error: "הליד לא נמצא" }, { status: 404 });
    phone = normalizeIsraeliPhone(lead.phone);
    leadId = lead.stage === "new" ? lead.id : null;
  } else if (to === "customer") {
    const biz = await prisma.business.findUnique({ where: { id }, select: { phone: true, settings: true } });
    const p = biz ? ownerPhoneOf(biz) : null;
    if (!p) return NextResponse.json({ error: "אין טלפון לבעל העסק" }, { status: 400 });
    phone = normalizeIsraeliPhone(p);
  } else if (to === "chat") {
    const conv = await prisma.conversation.findFirst({ where: { id, businessId: DEMO_BUSINESS_ID }, select: { id: true, phone: true } });
    if (!conv) return NextResponse.json({ error: "השיחה לא נמצאה" }, { status: 404 });
    if (conv.phone.startsWith("ig:")) return NextResponse.json({ error: "באינסטגרם אי אפשר לשלוח הקלטה מכאן" }, { status: 400 });
    phone = conv.phone;
    conversationId = conv.id;
  } else return NextResponse.json({ error: "missing" }, { status: 400 });

  const demo = await prisma.business.findUnique({ where: { id: DEMO_BUSINESS_ID }, select: { messagingProvider: true, whatsappNumber: true, greenApiInstanceId: true, greenApiToken: true, evolutionInstance: true } });
  const provider = demo ? providerForBusiness(demo) : null;
  if (!provider?.sendFileByUrl) return NextResponse.json({ error: "הקו של צ'אטור לא יכול לשלוח הקלטות" }, { status: 500 });

  const blob = await put(`wa-media/out/${DEMO_BUSINESS_ID}/${crypto.randomUUID()}.ogg`, Buffer.from(await file.arrayBuffer()), { access: "public", addRandomSuffix: false, contentType: "audio/ogg" });
  const result = await provider.sendFileByUrl(phone, { urlFile: blob.url, fileName: `voice-${Date.now()}.ogg` });
  await prisma.messageLog.create({
    data: { businessId: DEMO_BUSINESS_ID, customerPhone: phone, kind: "manual", body: VOICE_LABEL, status: result.ok ? "sent" : "failed", providerId: result.providerId ?? null, sentAt: result.ok ? new Date() : null },
  }).catch(() => {});
  if (!result.ok) return NextResponse.json({ error: "ההקלטה לא יצאה. בדוק את חיבור הוואטסאפ של צ'אטור." }, { status: 502 });

  if (!conversationId) {
    const conv = await prisma.conversation.findFirst({ where: { businessId: DEMO_BUSINESS_ID, phone: { in: [phone, phone.replace(/^972/, "0")] }, agentType: { not: "owner" } }, orderBy: { createdAt: "desc" }, select: { id: true } })
      ?? await prisma.conversation.create({ data: { businessId: DEMO_BUSINESS_ID, phone, agentType: "customer", status: "active" }, select: { id: true } });
    conversationId = conv.id;
  }
  await prisma.conversationMessage.create({ data: { conversationId, role: "assistant", source: "admin", content: VOICE_LABEL, mediaUrl: blob.url, mediaType: "audio", mediaMime: "audio/ogg" } });
  // A person took over: the sales agent stays quiet for 24h (like a typed message).
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), ...(to === "customer" ? {} : { escalatedAt: new Date() }) } });
  if (leadId) await prisma.lead.update({ where: { id: leadId }, data: { stage: "chatting", status: "contacted" } });
  if (to === "customer") await prisma.leadNote.create({ data: { businessId: id, author: "וואטסאפ", body: "נשלחה לבעל העסק הודעה קולית" } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
