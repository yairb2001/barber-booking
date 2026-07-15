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
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { sendMessage, firstName } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { tierHas } from "@/lib/tier";
import { FOLLOWUP_HARD_RULES, nowLineIsrael, isPhoneLikeName } from "@/lib/agent/followup-shared";

export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

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

function fallbackFollowup(name: string | null): string {
  const hi = name ? `היי ${name}, ` : "היי, ";
  return `${hi}ראיתי שהתחלנו ולא סגרנו תור — רוצה שאמצא לך שעה טובה?`;
}

/**
 * Write one short, contextual nudge from the conversation so far — or decide to
 * send NOTHING (returns null). The model must skip when the customer explicitly
 * declined/closed ("יקר לי, אוותר", "לא מעוניין", "תודה" as a goodbye) — chasing
 * after a clear "no" burns goodwill. It also gets the current time so it never
 * treats a slot that already passed as still on the table (offer to REBOOK
 * instead), plus the hard no-invented-discounts rules.
 */
async function generateFollowup(
  transcript: string,
  name: string | null,
  opts?: { isThirdTouch?: boolean },
): Promise<string | null> {
  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      system:
        "אתה נציג מספרה שמתכתב בוואטסאפ. הלקוח התחיל שיחה ולא סגר תור, ואתה שוקל לשלוח לו הודעת פולואפ אחת קצרה. " +
        nowLineIsrael() + " " +
        "קודם כל תחליט אם בכלל נכון לשלוח: " +
        "אם הלקוח סירב במפורש, ויתר, אמר שיקר לו וסגר, אמר שלא מעוניין, או שהשיחה הסתיימה בצורה מנומסת וסופית — החזר בדיוק את המילה SKIP ושום דבר אחר. " +
        "אם השיחה כבר לא רלוונטית (למשל דובר על תור לזמן שכבר עבר מזמן והלקוח נעלם) והפולואפ ירגיש מנותק — החזר SKIP. " +
        "אם כן נכון לשלוח: כתוב משפט אחד חם וטבעי שמחזיר אותו לקבוע תור, בלי לחץ ובלי להישמע כמו בוט. " +
        "כתוב בשפה שבה הלקוח כותב: לקוח שכתב בעברית מקבל עברית; לקוח שכתב באנגלית או שפה אחרת מקבל את אותה שפה. " +
        "שים לב לשעה הנוכחית: אם השעה או היום שדוברו בשיחה כבר עברו — אל תציע אותם שוב; הצע לקבוע מחדש לזמן שנוח לו. " +
        (opts?.isThirdTouch
          ? "דע שזו כבר הפנייה השלישית מצדנו בלי מענה — לכן תהיה עדין במיוחד, בלי שום תחושת רדיפה, נימה קלילה של 'כשנוח לך, אנחנו כאן'. "
          : "") +
        "בלי ירידות שורה, כמעט בלי אימוג'ים, ובלי לחזור מילה במילה על מה שכבר נאמר. " +
        (name ? `פנה ללקוח בשמו (${name}). ` : "אין לך את שם הלקוח — אל תשתמש בשום כינוי ואל תפנה אליו במספר טלפון. ") +
        FOLLOWUP_HARD_RULES + " " +
        "החזר רק את ההודעה עצמה (או SKIP), בלי הקדמות.",
      messages: [
        { role: "user", content: `זו השיחה עד עכשיו:\n\n${transcript}\n\nהחלט: SKIP או הודעת פולואפ אחת.` },
      ],
    });
    let text = "";
    for (const b of res.content) if (b.type === "text") text += b.text;
    text = text.trim();
    if (!text) return fallbackFollowup(name);
    // The model decided a follow-up would do more harm than good.
    if (/^SKIP\b/i.test(text)) return null;
    return text;
  } catch (e) {
    console.error("[followup] LLM failed", e);
    return fallbackFollowup(name);
  }
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

  let checked = 0, sent = 0, skipped = 0;

  for (const biz of businesses) {
    if (!tierHas(biz.tier, "aiAgent")) continue;
    const settings = (biz.settings as Record<string, unknown> | null) ?? {};
    if (settings.agentFollowupEnabled === false) continue;

    const convos = await prisma.conversation.findMany({
      where: {
        businessId:    biz.id,
        agentType:     "customer",
        escalatedAt:   null,
        lastMessageAt: { lt: quietBefore, gte: notOlderThan },
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

      // Confirm there was a real two-way exchange, and gather context for the LLM.
      const msgs = await prisma.conversationMessage.findMany({
        where:   { conversationId: convo.id, role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "desc" },
        take:    12,
        select:  { role: true, content: true },
      });
      const hasUser      = msgs.some(m => m.role === "user");
      const hasAssistant = msgs.some(m => m.role === "assistant");
      if (!hasUser || !hasAssistant) { skipped++; continue; }

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

  return NextResponse.json({ ok: true, checked, sent, skipped });
}
