import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST as greenWebhook } from "@/app/api/webhook/whatsapp/route";
import { evolutionMediaDataUrl } from "@/lib/messaging/evolution";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Webhook of our own WhatsApp server (Evolution API). Every event is translated
 * into the Green-API shape and handed to the existing webhook handler, so the
 * whole pipeline — persistence, blocking, link-first, burst coalescing, the
 * agent, the sales agent — stays one code path. Authenticated by ?key= (the
 * server's WEBHOOK_GLOBAL_URL carries it).
 *
 * Events used: messages.upsert (incoming, and phone-typed outgoing → mutes the
 * agent like Green's outgoingMessageReceived) and connection.update.
 */
type EvoKey = { remoteJid: string; fromMe: boolean; id: string };
type EvoMessage = {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { mimetype?: string; caption?: string };
  videoMessage?: { mimetype?: string; caption?: string };
  audioMessage?: { mimetype?: string };
  documentMessage?: { mimetype?: string; fileName?: string; caption?: string };
  stickerMessage?: { mimetype?: string };
  locationMessage?: unknown;
  contactMessage?: unknown;
  pollCreationMessage?: unknown;
};
type EvoEvent = {
  event?: string;
  instance?: string;
  data?: {
    key?: EvoKey; pushName?: string; message?: EvoMessage; messageType?: string; messageTimestamp?: number; source?: string;
    state?: string; statusReason?: number;
  };
};

const TYPE_MAP: Record<string, string> = {
  conversation: "textMessage", extendedTextMessage: "extendedTextMessage",
  imageMessage: "imageMessage", videoMessage: "videoMessage", audioMessage: "audioMessage",
  documentMessage: "documentMessage", stickerMessage: "stickerMessage", locationMessage: "locationMessage",
  contactMessage: "contactMessage", pollCreationMessage: "pollMessage",
};

export async function GET() { return NextResponse.json({ ok: true }); }

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (secret && new URL(req.url).searchParams.get("key") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let ev: EvoEvent;
  try { ev = await req.json(); } catch { return NextResponse.json({ ok: true, skipped: "non-json" }); }
  const instance = ev.instance;
  if (!instance) return NextResponse.json({ ok: true, skipped: "no-instance" });

  try {
    if (ev.event === "connection.update") {
      const state = ev.data?.state === "open" ? "authorized" : ev.data?.state === "connecting" ? "starting" : "notAuthorized";
      const now = new Date();
      await prisma.business.updateMany({ where: { evolutionInstance: instance }, data: { waLiveState: state, waCheckedAt: now, ...(state === "authorized" ? { waDownSince: null, whatsappStatus: "connected" } : {}) } });
      return NextResponse.json({ ok: true, state });
    }
    if (ev.event !== "messages.upsert" || !ev.data?.key) return NextResponse.json({ ok: true, skipped: ev.event ?? "unknown" });

    const key = ev.data.key;
    const jid = key.remoteJid || "";
    if (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid === "status@broadcast") return NextResponse.json({ ok: true, skipped: "group" });
    const phone = jid.replace(/@.*$/, "").replace(/:\d+$/, "");
    const msg = ev.data.message ?? {};
    const mtype = ev.data.messageType || Object.keys(msg).find(k => TYPE_MAP[k]) || "";
    const typeMessage = TYPE_MAP[mtype] ?? "unknownMessage";
    const text = msg.conversation ?? msg.extendedTextMessage?.text ?? "";

    // Outgoing: only messages typed on the phone itself (Evolution reports the
    // device source); replies we sent through the API come back as "unknown"/"web"? —
    // Baileys marks API sends without a device source, so anything with a real
    // device source is a human taking over the chat.
    if (key.fromMe) {
      const src = ev.data.source ?? "";
      if (!["android", "ios", "desktop", "web"].includes(src)) return NextResponse.json({ ok: true, skipped: "api-sent" });
    }

    const media = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(typeMessage);
    let fileMessageData: Record<string, unknown> | undefined;
    if (media && !key.fromMe) {
      const m = (msg.imageMessage ?? msg.videoMessage ?? msg.audioMessage ?? msg.documentMessage ?? msg.stickerMessage ?? {}) as { mimetype?: string; caption?: string; fileName?: string };
      const dataUrl = await evolutionMediaDataUrl(instance, key).catch(() => null);
      fileMessageData = { downloadUrl: dataUrl ?? undefined, mimeType: m.mimetype, fileName: m.fileName, caption: m.caption };
    }

    const green = {
      typeWebhook: key.fromMe ? "outgoingMessageReceived" : "incomingMessageReceived",
      idMessage: key.id,
      timestamp: ev.data.messageTimestamp,
      instanceData: { idInstance: instance },
      senderData: { chatId: `${phone}@c.us`, sender: `${phone}@c.us`, senderName: ev.data.pushName ?? "" },
      messageData: {
        typeMessage,
        ...(typeMessage === "textMessage" ? { textMessageData: { textMessage: text } } : {}),
        ...(typeMessage === "extendedTextMessage" ? { extendedTextMessageData: { text } } : {}),
        ...(fileMessageData ? { fileMessageData } : {}),
      },
    };
    const url = new URL("/api/webhook/whatsapp", req.url);
    if (process.env.WHATSAPP_WEBHOOK_TOKEN) url.searchParams.set("token", process.env.WHATSAPP_WEBHOOK_TOKEN);
    const inner = new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(green) });
    const res = await greenWebhook(inner);
    const j = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: true, via: "green-shape", result: j });
  } catch (e) {
    console.error("[evolution-webhook]", e);
    return NextResponse.json({ ok: true, error: "handled" });
  }
}
