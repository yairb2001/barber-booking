import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { POST as greenWebhook } from "@/app/api/webhook/whatsapp/route";
import { fetchAsDataUrl } from "@/lib/messaging/evolution";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Webhook of our own WhatsApp server (GOWA engine — src/lib/messaging/evolution.ts).
 * Each event is translated into the Green-API shape and handed to the existing
 * handler, so persistence, blocking, link-first, burst coalescing, the agent and
 * the sales agent stay one code path.
 *
 * Authentication: the HMAC-SHA256 of the raw body (X-Hub-Signature-256), signed
 * with the per-device webhook secret we registered (GOWA_WEBHOOK_SECRET).
 *
 * `session_id` is the device id we created = Business.evolutionInstance (the slug).
 */
type Media = string | { path?: string; caption?: string; url?: string } | undefined;
type GowaEvent = {
  event?: string;
  device_id?: string;
  session_id?: string;
  payload?: {
    id?: string; chat_id?: string; from?: string; from_name?: string; sender_display_name?: string;
    timestamp?: string; is_from_me?: boolean; body?: string;
    image?: Media; video?: Media; audio?: Media; document?: Media; sticker?: Media;
    location?: unknown; contact?: unknown;
  };
};

const MIME_BY_EXT: Record<string, string> = { jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", ogg: "audio/ogg; codecs=opus", oga: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", pdf: "application/pdf" };
const pathOf = (m: Media): string | null => (typeof m === "string" ? m : m?.path || null);
const captionOf = (m: Media): string | undefined => (typeof m === "object" && m ? m.caption : undefined);

function verify(raw: string, header: string | null): boolean {
  const secret = process.env.GOWA_WEBHOOK_SECRET;
  if (!secret) return false;
  const given = (header || "").replace(/^sha256=/, "");
  const want = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  try { return given.length === want.length && timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(want, "hex")); } catch { return false; }
}

export async function GET() { return NextResponse.json({ ok: true }); }

export async function POST(req: NextRequest): Promise<NextResponse> {
  const raw = await req.text();
  if (!verify(raw, req.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let ev: GowaEvent;
  try { ev = JSON.parse(raw); } catch { return NextResponse.json({ ok: true, skipped: "non-json" }); }
  const p = ev.payload;
  if (ev.event !== "message" || !p?.id) return NextResponse.json({ ok: true, skipped: ev.event ?? "unknown" });

  try {
    // Which business: the device id we registered; fall back to the device's own number.
    const session = ev.session_id || null;
    const ownNumber = (ev.device_id || "").replace(/@.*$/, "").replace(/:\d+$/, "");
    const biz = session
      ? await prisma.business.findFirst({ where: { evolutionInstance: session }, select: { evolutionInstance: true } })
      : null;
    const instance = biz?.evolutionInstance ?? session;
    if (!instance) return NextResponse.json({ ok: true, skipped: "no-session" });

    const chat = p.chat_id || p.from || "";
    if (chat.endsWith("@g.us") || chat.endsWith("@broadcast") || chat.endsWith("@newsletter")) return NextResponse.json({ ok: true, skipped: "group" });
    // 1:1 chat: the customer is the chat. (`from` is our own number on outgoing messages.)
    const phone = chat.replace(/@.*$/, "").replace(/:\d+$/, "");
    if (!/^\d{8,15}$/.test(phone) || phone === ownNumber) return NextResponse.json({ ok: true, skipped: "no-phone" });

    // Outgoing: only what a human typed on the phone counts as "took over the chat".
    // Messages sent by a linked companion (ours, through the API) carry web-style
    // ids ("3EB0…"); the phone app's ids don't.
    if (p.is_from_me && /^3EB0/i.test(p.id)) return NextResponse.json({ ok: true, skipped: "api-sent" });

    const kinds: [string, Media][] = [["imageMessage", p.image], ["videoMessage", p.video], ["audioMessage", p.audio], ["documentMessage", p.document], ["stickerMessage", p.sticker]];
    const media = kinds.find(([, m]) => !!pathOf(m));
    const text = (p.body || "").trim();
    let typeMessage = "textMessage";
    let fileMessageData: Record<string, unknown> | undefined;
    if (media) {
      typeMessage = media[0];
      const mpath = pathOf(media[1])!;
      const ext = (mpath.split(".").pop() || "").toLowerCase();
      const dataUrl = p.is_from_me ? null : await fetchAsDataUrl(mpath, MIME_BY_EXT[ext]?.split(";")[0] ?? "application/octet-stream");
      fileMessageData = { downloadUrl: dataUrl ?? undefined, mimeType: MIME_BY_EXT[ext], fileName: mpath.split("/").pop(), caption: captionOf(media[1]) ?? (text || undefined) };
    } else if (p.location) typeMessage = "locationMessage";
    else if (p.contact) typeMessage = "contactMessage";
    else if (!text) return NextResponse.json({ ok: true, skipped: "empty" });

    const green = {
      typeWebhook: p.is_from_me ? "outgoingMessageReceived" : "incomingMessageReceived",
      idMessage: p.id,
      timestamp: p.timestamp ? Math.floor(new Date(p.timestamp).getTime() / 1000) : undefined,
      instanceData: { idInstance: instance },
      senderData: { chatId: `${phone}@c.us`, sender: `${phone}@c.us`, senderName: p.is_from_me ? "" : (p.from_name || p.sender_display_name || "") },
      messageData: {
        typeMessage,
        ...(typeMessage === "textMessage" ? { textMessageData: { textMessage: text } } : {}),
        ...(fileMessageData ? { fileMessageData } : {}),
      },
    };
    const url = new URL("/api/webhook/whatsapp", req.url);
    if (process.env.WHATSAPP_WEBHOOK_TOKEN) url.searchParams.set("token", process.env.WHATSAPP_WEBHOOK_TOKEN);
    const inner = new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(green) });
    const res = await greenWebhook(inner);
    const j = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: true, result: j });
  } catch (e) {
    console.error("[gowa-webhook]", e);
    return NextResponse.json({ ok: true, error: "handled" });
  }
}
