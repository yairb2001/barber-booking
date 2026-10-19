/**
 * Conversation follow-up cron.
 * Finds chats that went quiet WITHOUT ending in a booking and sends ONE warm,
 * natural nudge that drives the customer back toward booking a slot.
 *
 * Guards: the AI agent must be enabled and the tier must include it. Skips chats
 * escalated to a human, chats already followed up, and customers who already
 * have an upcoming appointment. One follow-up per conversation (deduped via a
 * MessageLog of kind "agent_followup").
 *
 * Owners can turn this off per-business with settings.agentFollowupEnabled=false.
 *
 * Secure with CRON_SECRET: GET /api/cron/conversation-followup?secret=<CRON_SECRET>
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage, firstName } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { tierHas } from "@/lib/tier";
import { isPhoneLikeName, generateFollowup } from "@/lib/agent/followup-shared";
import { runCustomerAgent, escalateToHuman } from "@/lib/agent/customer-agent";
import { unansweredRun, runConfirmsSlot } from "@/lib/agent/pending-confirmation";

export const dynamic = "force-dynamic";

const MIN_QUIET_MS = 60 * 60 * 1000;        // wait at least 1h after the last message
// Look back far enough to carry an evening/overnight abandon into the next
// morning (quiet hours blocked the nudge last night → the morning run still
// finds the chat), but no further: a follow-up on a 2-day-old chat reads as
// stale and irrelevant (real incident). 24h covers the overnight carry.
const MAX_AGE_MS   = 24 * 60 * 60 * 1000;

// If the link-first 30-min nudge ("הסתדרת עם האתר?") went unanswered, the next
// follow-up is our THIRD outbound message — space it at least this far from the
// nudge (quiet hours then naturally push an evening slot to next morning).
const AFTER_LINK_NUDGE_GAP_MS = 6 * 60 * 60 * 1000;

// Quiet hours: only nudge between 09:00–21:00 Israel time. This endpoint is
// driven every couple of hours (cron-job.org), so without this guard a
// follow-up could fire at 3am. Intl handles Israel DST automatically.
const SEND_FROM_HOUR = 9;
const SEND_TO_HOUR   = 21;
function israelHour(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find(p => p.type === "hour")?.value ?? "0");
  return h === 24 ? 0 : h; // some engines render midnight as "24"
}

export async function GET(req: NextRequest) {
  // Accept Vercel Cron's `Authorization: Bearer <CRON_SECRET>` header (this is
  // what the daily schedule actually sends) as well as a manual ?secret= /
  // x-cron-secret trigger. Without the Bearer branch the daily run 401'd and
  // NO follow-up was ever sent.
  const { searchParams } = new URL(req.url);
  const provided =
    searchParams.get("secret") ||
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Respect quiet hours regardless of how often the cron fires.
  const hour = israelHour(now);
  if (hour < SEND_FROM_HOUR || hour >= SEND_TO_HOUR) {
    return NextResponse.json({ ok: true, skipped: "quiet_hours", israelHour: hour });
  }

  const quietBefore  = new Date(now.getTime() - MIN_QUIET_MS);
  const notOlderThan = new Date(now.getTime() - MAX_AGE_MS);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Businesses with the agent switched on.
  const agentConfigs = await prisma.agentConfig.findMany({
    where: { isEnabled: true },
    select: { businessId: true },
  });
  const bizIds = agentConfigs.map(c => c.businessId);
  if (!bizIds.length) return NextResponse.json({ ok: true, sent: 0 });

  const businesses = await prisma.business.findMany({
    where: { id: { in: bizIds } },
    select: { id: true, tier: true, settings: true },
  });

  let checked = 0, sent = 0, skipped = 0, answeredLate = 0;

  for (const biz of businesses) {
    if (!tierHas(biz.tier, "aiAgent")) continue;
    let settings: Record<string, unknown> = {};
    try { settings = typeof biz.settings === "string" ? JSON.parse(biz.settings) : ((biz.settings as Record<string, unknown> | null) ?? {}); } catch { /* bad JSON = defaults */ }
    if (settings.agentFollowupEnabled === false) continue;

    const convos = await prisma.conversation.findMany({
      where: {
        businessId:    biz.id,
        agentType:     "customer",
        escalatedAt:   null,
        lastMessageAt: { lt: quietBefore, gte: notOlderThan },
        // Instagram chats ("ig:<IGSID>") have no agent yet, and their key is not a phone number.
        NOT:           { phone: { startsWith: "ig:" } },
      },
      select: { id: true, phone: true, customerId: true, whatsappName: true },
    });

    for (const convo of convos) {
      checked++;
      const phone      = normalizeIsraeliPhone(convo.phone);
      const localPhone = phone.replace(/^972/, "0");

      // Already nudged on this conversation? (deduped via MessageLog)
      const already = await prisma.messageLog.findFirst({
        where: {
          businessId:    biz.id,
          customerPhone: { in: [phone, localPhone, convo.phone] },
          kind:          { in: ["agent_followup", "agent_question_followup"] },
          createdAt:     { gte: notOlderThan },
        },
        select: { id: true },
      });
      if (already) { skipped++; continue; }

      // Link-first nudge pacing: if the fixed 30-min nudge was already sent and
      // the customer hasn't answered it, this follow-up is our THIRD message —
      // hold off until at least 6h after the nudge (evenings roll to morning via
      // the quiet-hours gate above).
      const lastLinkNudge = await prisma.messageLog.findFirst({
        where: {
          businessId:    biz.id,
          customerPhone: { in: [phone, localPhone, convo.phone] },
          kind:          "link_nudge",
        },
        orderBy: { createdAt: "desc" },
        select:  { createdAt: true },
      });
      const isThirdTouch = !!lastLinkNudge;
      if (lastLinkNudge && now.getTime() - lastLinkNudge.createdAt.getTime() < AFTER_LINK_NUDGE_GAP_MS) {
        skipped++;
        continue;
      }

      // Customer already booked → leave them be. Checks BOTH an upcoming
      // appointment AND any appointment created in the lookback window (a
      // same-day visit that already ended still means "he booked").
      const upcoming = await prisma.appointment.findFirst({
        where: {
          businessId: biz.id,
          status:     { notIn: ["cancelled_by_customer", "cancelled_by_staff"] },
          customer:   { is: { OR: [{ phone }, { phone: localPhone }] } },
          OR: [
            { date: { gte: startOfToday } },
            { createdAt: { gte: notOlderThan } },
          ],
        },
        select: { id: true },
      });
      if (upcoming) { skipped++; continue; }

      // Respect blocked / opted-out customers — this is a "come back and book"
      // nudge, exactly the kind of proactive outreach opting out silences.
      const custStatus = await prisma.customer.findFirst({
        where: { businessId: biz.id, deletedAt: null, OR: [{ phone }, { phone: localPhone }] },
        select: { isBlocked: true, messagingOptOut: true },
      });
      if (custStatus?.isBlocked || custStatus?.messagingOptOut) { skipped++; continue; }

      // Confirm there was a real two-way exchange, and gather context for the LLM.
      const msgs = await prisma.conversationMessage.findMany({
        where:   { conversationId: convo.id, role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "desc" },
        take:    12,
        select:  { role: true, content: true, createdAt: true },
      });
      const hasUser      = msgs.some(m => m.role === "user");
      const hasAssistant = msgs.some(m => m.role === "assistant");
      if (!hasUser || !hasAssistant) { skipped++; continue; }

      // The customer wrote last and nobody answered (19.10.2026, the Michael case: he said
      // "Yes" + "14:30", the agent was down, and this nudge, which cannot book, wrote
      // "Can't wait to confirm you … at 14:30"). A nudge is never the answer to an open
      // message: the real agent answers it now (it can book). A slot he confirmed is booked,
      // then a person takes the chat (Yair: every business).
      const pending = unansweredRun(msgs.slice().reverse());
      if (pending) {
        const confirmed = runConfirmsSlot(pending.offerContext, pending.run);
        try {
          await runCustomerAgent({ businessId: biz.id, phone, incomingText: pending.run, alreadyPersisted: true });
          if (confirmed) {
            await escalateToHuman({
              bizId: biz.id, conversationId: convo.id, callerPhone: phone,
              reason: "הלקוח אישר שעה שהוצעה לו ולא קיבל מענה בזמן. הסוכן ענה עכשיו באיחור וקבע את התור. כדאי לוודא מולו שהכל בסדר.",
            });
          }
          answeredLate++;
        } catch (e) {
          console.error("[followup] late answer failed", phone, e);
          await escalateToHuman({
            bizId: biz.id, conversationId: convo.id, callerPhone: phone,
            reason: "הודעה של הלקוח נשארה בלי מענה, והסוכן לא הצליח לענות לה גם באיחור.",
          }).catch(() => {});
          skipped++;
        }
        continue;
      }

      const transcript = msgs
        .reverse()
        .map(m => `${m.role === "user" ? "לקוח" : "סוכן"}: ${m.content}`)
        .join("\n");

      // Name resolution: registered customer name (by link OR by phone) wins,
      // then the WhatsApp display name — but NEVER a phone-like "name" (some
      // profiles have no name and the pushname arrives as the number; addressing
      // a customer by their phone number is worse than no name at all).
      let name: string | null =
        convo.whatsappName && !isPhoneLikeName(convo.whatsappName)
          ? firstName(convo.whatsappName)
          : null;
      const registered = convo.customerId
        ? await prisma.customer.findUnique({ where: { id: convo.customerId }, select: { name: true } })
        : await prisma.customer.findFirst({
            where: { businessId: biz.id, deletedAt: null, OR: [{ phone }, { phone: localPhone }] },
            select: { name: true },
          });
      if (registered?.name && !isPhoneLikeName(registered.name)) name = firstName(registered.name);

      const followup = await generateFollowup(transcript, name, { isThirdTouch });
      // Model decided a follow-up would hurt (explicit decline / stale context).
      if (followup === null) { skipped++; continue; }

      try {
        await prisma.conversationMessage.create({
          data: { conversationId: convo.id, role: "assistant", content: followup },
        });
        await sendMessage({
          businessId:    biz.id,
          customerPhone: phone,
          kind:          "agent_followup",
          body:          followup,
        });
        sent++;
      } catch (e) {
        console.error("[followup] send failed", phone, e);
        skipped++;
      }
    }
  }

  return NextResponse.json({ ok: true, checked, sent, skipped, answeredLate });
}
