import { NextRequest, NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * TEMPORARY Instagram connection-experiment webhook (plan doc, tab "ערוץ אינסטגרם").
 * Only proves that Meta can reach us and shows what arrives: it verifies the
 * request, logs one short line per event and answers 200. No database, no agent,
 * no sending. Message text and tokens are never logged. Grows into the real
 * handler later.
 *
 * GET  = Meta's subscribe handshake (INSTAGRAM_VERIFY_TOKEN).
 * POST = events, signed with X-Hub-Signature-256 = HMAC-SHA256(raw body, INSTAGRAM_APP_SECRET).
 */

function sameString(a: string, b: string): boolean {
  // Hash first so the comparison is constant-time even when the lengths differ.
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

function verifySignature(raw: string, header: string | null): boolean {
  const secret = process.env.INSTAGRAM_APP_SECRET;
  if (!secret) return false;
  const given = (header || "").replace(/^sha256=/, "");
  const want = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  try { return given.length === want.length && timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(want, "hex")); } catch { return false; }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = req.nextUrl.searchParams;
  const expected = process.env.INSTAGRAM_VERIFY_TOKEN;
  const token = q.get("hub.verify_token");
  const challenge = q.get("hub.challenge");
  if (!expected || q.get("hub.mode") !== "subscribe" || token === null || challenge === null || !sameString(token, expected)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  console.log("[ig-webhook] verified");
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "-");

export async function POST(req: NextRequest): Promise<NextResponse> {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    console.warn(`[ig-webhook] bad-signature bytes=${raw.length} hasHeader=${req.headers.has("x-hub-signature-256")}`);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body: unknown = JSON.parse(raw);
    if (!isObj(body)) return NextResponse.json({ ok: true });
    const object = str(body.object);
    const entries = Array.isArray(body.entry) ? body.entry : [];
    for (const entry of entries) {
      if (!isObj(entry)) continue;
      const entryId = str(entry.id);
      const events = Array.isArray(entry.messaging) ? entry.messaging : [];
      for (const ev of events) {
        if (!isObj(ev)) continue;
        const sender = isObj(ev.sender) ? str(ev.sender.id) : "-";
        const msg = isObj(ev.message) ? ev.message : null;
        if (msg) {
          const atts = Array.isArray(msg.attachments) ? msg.attachments.map((a) => (isObj(a) ? str(a.type) : "-")).join(",") : "";
          const textLen = typeof msg.text === "string" ? msg.text.length : 0;
          console.log(`[ig-webhook] object=${object} entry=${entryId} sender=${sender} mid=${str(msg.mid)} echo=${msg.is_echo === true} textLen=${textLen} att=${atts || "none"} ts=${str(ev.timestamp)}`);
        } else {
          // read receipts, reactions, postbacks and the like: log the kind only
          const kinds = Object.keys(ev).filter((k) => k !== "sender" && k !== "recipient" && k !== "timestamp").join(",") || "unknown";
          console.log(`[ig-webhook] object=${object} entry=${entryId} sender=${sender} event=${kinds} ts=${str(ev.timestamp)}`);
        }
      }
      if (Array.isArray(entry.changes)) {
        for (const ch of entry.changes) console.log(`[ig-webhook] object=${object} entry=${entryId} change=${isObj(ch) ? str(ch.field) : "-"}`);
      }
    }
  } catch {
    console.warn("[ig-webhook] non-json body");
  }
  return NextResponse.json({ ok: true });
}
