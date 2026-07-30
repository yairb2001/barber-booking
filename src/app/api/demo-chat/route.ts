/**
 * Public /for-business live agent demo — chat with the REAL customer agent
 * against a fixed demo business ("המספרה של דני", DEMO_BUSINESS_ID), no
 * WhatsApp/GreenAPI involved. See src/lib/demo-widget.ts for why this is safe
 * to expose to anonymous traffic and why no real message ever goes out.
 *
 * POST — send one visitor message, get the agent's reply bubble(s) back.
 * GET  — poll for any new assistant messages since a timestamp (picks up the
 *        async sales pitch from demo-sales-agent.ts, which arrives on its own
 *        schedule via the drip-queue piggyback, not synchronously with a POST).
 *
 * Lead capture: if a phone-number-shaped reply arrives AFTER a sales pitch was
 * already sent to this session, it's captured directly here (dedupe via
 * MessageLog kind "demo_lead_captured") and the owner is notified — the
 * booking agent never sees that turn, so there's no need to teach it how to
 * handle "here's my number" mid-conversation.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runCustomerAgent } from "@/lib/agent/customer-agent";
import { notifyPlatformOwner } from "@/lib/super-admin";
import {
  DEMO_BUSINESS_ID,
  isValidSessionId,
  demoPhoneFor,
  checkRateLimit,
  maybeCleanupRateLimitMap,
  extractIsraeliPhone,
} from "@/lib/demo-widget";

export const dynamic = "force-dynamic";

const MAX_TEXT_LENGTH = 1000;

export async function POST(req: NextRequest) {
  maybeCleanupRateLimitMap();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { sessionId, text } = (body ?? {}) as { sessionId?: unknown; text?: unknown };

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "invalid_session" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: "invalid_text" }, { status: 400 });
  }

  // Rate-limit on the session id itself, plus a coarser IP-based key so one
  // visitor can't just mint new session ids to bypass the per-session limit.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(sessionId) || !checkRateLimit(`ip:${ip}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const phone = demoPhoneFor(sessionId);
  const startedAt = new Date();

  // ── Lead capture intercept ────────────────────────────────────────────────
  // Only after a pitch was already sent, and only if we haven't already
  // captured this session as a lead.
  const alreadyPitched = await prisma.messageLog.findFirst({
    where: { businessId: DEMO_BUSINESS_ID, customerPhone: phone, kind: "demo_sales_pitch" },
    select: { id: true },
  });
  if (alreadyPitched) {
    const alreadyCaptured = await prisma.messageLog.findFirst({
      where: { businessId: DEMO_BUSINESS_ID, customerPhone: phone, kind: "demo_lead_captured" },
      select: { id: true },
    });
    const capturedPhone = !alreadyCaptured ? extractIsraeliPhone(text) : null;
    if (capturedPhone) {
      const conversation = await prisma.conversation.findFirst({
        where: { businessId: DEMO_BUSINESS_ID, phone },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const thankYou = "מעולה, קיבלנו את הפרטים — ניצור איתך קשר בקרוב! 🙏";
      if (conversation) {
        await prisma.conversationMessage.create({
          data: { conversationId: conversation.id, role: "user", content: text },
        });
        await prisma.conversationMessage.create({
          data: { conversationId: conversation.id, role: "assistant", content: thankYou },
        });
      }
      await prisma.messageLog.create({
        data: {
          businessId: DEMO_BUSINESS_ID,
          customerPhone: phone,
          kind: "demo_lead_captured",
          body: capturedPhone,
          status: "sent",
          sentAt: new Date(),
        },
      });
      notifyPlatformOwner(
        `🎯 ליד חדש מדמו האתר!\nמספר: ${capturedPhone}\n(שיחת דמו: ${phone})`,
      ).catch(() => {});
      return NextResponse.json({ bubbles: [thankYou], leadCaptured: true });
    }
  }

  // ── Normal flow: let the real agent handle it ─────────────────────────────
  try {
    await runCustomerAgent({ businessId: DEMO_BUSINESS_ID, phone, incomingText: text });
  } catch (e) {
    console.error("[demo-chat] agent failed", e);
    return NextResponse.json({ error: "agent_error" }, { status: 500 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { businessId: DEMO_BUSINESS_ID, phone },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!conversation) return NextResponse.json({ bubbles: [] });

  const replies = await prisma.conversationMessage.findMany({
    where: { conversationId: conversation.id, role: "assistant", createdAt: { gte: startedAt } },
    orderBy: { createdAt: "asc" },
    select: { content: true },
  });

  return NextResponse.json({ bubbles: replies.map(r => r.content) });
}

/** Poll for any assistant messages that arrived after `since` — picks up the
 *  async sales pitch (demo-sales-agent.ts), which is written on its own timer,
 *  not in response to a POST. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  const since = searchParams.get("since");

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "invalid_session" }, { status: 400 });
  }
  const sinceDate = since ? new Date(since) : new Date(0);
  if (Number.isNaN(sinceDate.getTime())) {
    return NextResponse.json({ error: "invalid_since" }, { status: 400 });
  }

  const phone = demoPhoneFor(sessionId);
  const conversation = await prisma.conversation.findFirst({
    where: { businessId: DEMO_BUSINESS_ID, phone },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!conversation) return NextResponse.json({ bubbles: [] });

  const replies = await prisma.conversationMessage.findMany({
    where: { conversationId: conversation.id, role: "assistant", createdAt: { gt: sinceDate } },
    orderBy: { createdAt: "asc" },
    select: { content: true },
  });

  return NextResponse.json({ bubbles: replies.map(r => r.content) });
}
