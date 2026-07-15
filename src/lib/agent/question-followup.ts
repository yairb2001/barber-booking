/**
 * Agent question follow-up — core scan.
 *
 * SEPARATE from conversation-followup. That one is a slow, next-morning catch-all
 * for chats that opened but never closed with a booking. THIS one is a fast (~1h)
 * nudge for a specific case: the agent asked the customer a question and the
 * customer went silent. We gently re-ask so the thread doesn't die on an open
 * question.
 *
 * Trigger: the most recent message in the conversation is from the agent
 * (role="assistant", source="agent") AND it reads like a question (contains "?"),
 * and it's been 1–6h with no customer reply.
 *
 * Guards: agent enabled + tier includes it, not escalated to a human, quiet hours
 * 09:00–21:00 Israel time, one nudge per conversation (deduped via MessageLog).
 * To avoid double-messaging, dedup counts BOTH this kind and the slow
 * "agent_followup" kind — a customer gets at most one of the two.
 *
 * Owners can turn this off per-business with settings.agentQuestionFollowupEnabled=false.
 *
 * runAgentQuestionFollowup() is called both from the standalone cron GET and —
 * so it runs without a dedicated external job — from the every-minute drip-queue.
 * It's idempotent and safe to call often.
 */
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { sendMessage, firstName } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { tierHas } from "@/lib/tier";
import { FOLLOWUP_HARD_RULES, nowLineIsrael, isPhoneLikeName } from "@/lib/agent/followup-shared";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const MIN_QUIET_MS = 60 * 60 * 1000;        // wait at least 1h after the agent's question
// Keep the window tight: a pending question is time-sensitive, so we only chase
// it for a few hours. If it goes unanswered longer (e.g. overnight), the slow
// conversation-followup picks it up the next morning with a generic nudge.
const MAX_AGE_MS   = 6 * 60 * 60 * 1000;

// Quiet hours: only nudge between 09:00–21:00 Israel time. Intl handles DST.
const SEND_FROM_HOUR = 9;
const SEND_TO_HOUR   = 21;
function israelHour(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find(p => p.type === "hour")?.value ?? "0");
  return h === 24 ? 0 : h;
}

function fallbackFollowup(name: string | null): string {
  const hi = name ? `היי ${name}, ` : "היי, ";
  return `${hi}רק מוודא שלא פספסת — עדיין מחכה לתשובה שלך כדי שנתקדם.`;
}

/**
 * Write one short nudge that follows up on the agent's unanswered question — or
 * decide to send NOTHING (returns null) when the customer already declined or
 * the question is no longer relevant (e.g. it was about a time that passed).
 */
async function generateFollowup(transcript: string, name: string | null): Promise<string | null> {
  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      system:
        "אתה נציג מספרה שמתכתב בוואטסאפ. שאלת את הלקוח שאלה והוא עוד לא ענה, ואתה שוקל לשלוח תזכורת אחת קצרה שממשיכה בדיוק מאותה שאלה. " +
        nowLineIsrael() + " " +
        "קודם כל תחליט אם בכלל נכון לשלוח: אם הלקוח כבר סירב/ויתר במפורש, או שהשאלה כבר לא רלוונטית (למשל דובר על שעה שכבר עברה) — החזר בדיוק את המילה SKIP ושום דבר אחר. " +
        "אם כן נכון לשלוח: כתוב משפט אחד חם וטבעי שמזכיר בעדינות את השאלה שנשארה פתוחה ומזמין אותו לענות, בלי לחץ ובלי להישמע כמו בוט. " +
        "כתוב בשפה שבה הלקוח כותב: לקוח שכתב בעברית מקבל עברית; לקוח שכתב באנגלית או שפה אחרת מקבל את אותה שפה. " +
        "שים לב לשעה הנוכחית: אם השעה שדוברה כבר עברה — אל תציע אותה שוב; הצע לקבוע מחדש לזמן שנוח לו. " +
        "בלי ירידות שורה, כמעט בלי אימוג'ים, ובלי לחזור מילה במילה על מה שכבר נאמר. " +
        (name ? `פנה ללקוח בשמו (${name}). ` : "אין לך את שם הלקוח — אל תשתמש בשום כינוי ואל תפנה אליו במספר טלפון. ") +
        FOLLOWUP_HARD_RULES + " " +
        "החזר רק את ההודעה עצמה (או SKIP), בלי הקדמות.",
      messages: [
        { role: "user", content: `זו השיחה עד עכשיו:\n\n${transcript}\n\nהחלט: SKIP או תזכורת אחת קצרה על השאלה שנשארה פתוחה.` },
      ],
    });
    let text = "";
    for (const b of res.content) if (b.type === "text") text += b.text;
    text = text.trim();
    if (!text) return fallbackFollowup(name);
    if (/^SKIP\b/i.test(text)) return null;
    return text;
  } catch (e) {
    console.error("[question-followup] LLM failed", e);
    return fallbackFollowup(name);
  }
}

export async function runAgentQuestionFollowup(
  now: Date = new Date(),
): Promise<{ ok: true; checked: number; sent: number; skipped: number } | { ok: true; skipped: "quiet_hours"; israelHour: number }> {
  const hour = israelHour(now);
  if (hour < SEND_FROM_HOUR || hour >= SEND_TO_HOUR) {
    return { ok: true, skipped: "quiet_hours", israelHour: hour };
  }

  const quietBefore  = new Date(now.getTime() - MIN_QUIET_MS);
  const notOlderThan = new Date(now.getTime() - MAX_AGE_MS);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Dedup window: don't nudge if ANY follow-up (this kind or the slow one) went
  // out in the last day and a half — keeps the two crons from double-messaging.
  const dedupSince = new Date(now.getTime() - 36 * 60 * 60 * 1000);

  const agentConfigs = await prisma.agentConfig.findMany({
    where: { isEnabled: true },
    select: { businessId: true },
  });
  const bizIds = agentConfigs.map(c => c.businessId);
  if (!bizIds.length) return { ok: true, checked: 0, sent: 0, skipped: 0 };

  const businesses = await prisma.business.findMany({
    where: { id: { in: bizIds } },
    select: { id: true, tier: true, settings: true },
  });

  let checked = 0, sent = 0, skipped = 0;

  for (const biz of businesses) {
    if (!tierHas(biz.tier, "aiAgent")) continue;
    const settings = (biz.settings as Record<string, unknown> | null) ?? {};
    if (settings.agentQuestionFollowupEnabled === false) continue;

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

      // The most recent turn must be the agent asking a question that the
      // customer hasn't answered. Pull recent user/assistant messages and look
      // at the newest one.
      const msgs = await prisma.conversationMessage.findMany({
        where:   { conversationId: convo.id, role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "desc" },
        take:    12,
        select:  { role: true, source: true, content: true },
      });
      if (!msgs.length) { skipped++; continue; }

      const last = msgs[0];
      // Newest message must be from the AI agent (not the customer, not a human
      // admin reply) and must read like a question.
      const isAgentQuestion =
        last.role === "assistant" &&
        last.source === "agent" &&
        last.content.includes("?");
      if (!isAgentQuestion) { skipped++; continue; }
      // Require a real two-way exchange (the customer said something earlier).
      if (!msgs.some(m => m.role === "user")) { skipped++; continue; }

      // Already nudged (either kind) recently? Don't double up.
      const already = await prisma.messageLog.findFirst({
        where: {
          businessId:    biz.id,
          customerPhone: { in: [phone, localPhone, convo.phone] },
          kind:          { in: ["agent_question_followup", "agent_followup"] },
          createdAt:     { gte: dedupSince },
        },
        select: { id: true },
      });
      if (already) { skipped++; continue; }

      // Link-first pacing: the fixed greeting/nudge end with a question mark, so
      // without this guard we'd chase them after just 1h — the owner's rule is
      // that after the automation + its 30-min nudge, the NEXT touch waits ≥6h
      // (real incident: nudge 10:30 → question-followup 11:30). Applies to any
      // automation sent in the last 6h, answered or not — if the customer DID
      // reply, the newest message is theirs and this candidate is filtered
      // earlier anyway.
      const recentAutomation = await prisma.messageLog.findFirst({
        where: {
          businessId:    biz.id,
          customerPhone: { in: [phone, localPhone, convo.phone] },
          kind:          { in: ["greeting_link", "link_nudge"] },
          createdAt:     { gte: new Date(now.getTime() - 6 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (recentAutomation) { skipped++; continue; }

      // Customer already booked → they're sorted, leave them. Checks BOTH an
      // upcoming appointment AND any appointment created since yesterday (a
      // same-day visit that already ended still means "he booked — don't chase").
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

      const transcript = [...msgs]
        .reverse()
        .map(m => `${m.role === "user" ? "לקוח" : "סוכן"}: ${m.content}`)
        .join("\n");

      // Registered customer name (by link OR by phone) wins over the WhatsApp
      // display name; never use a phone-like "name" (better no name at all).
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

      const followup = await generateFollowup(transcript, name);
      // Model decided the reminder would hurt (declined / no longer relevant).
      if (followup === null) { skipped++; continue; }

      try {
        await prisma.conversationMessage.create({
          data: { conversationId: convo.id, role: "assistant", content: followup },
        });
        await sendMessage({
          businessId:    biz.id,
          customerPhone: phone,
          kind:          "agent_question_followup",
          body:          followup,
        });
        sent++;
      } catch (e) {
        console.error("[question-followup] send failed", phone, e);
        skipped++;
      }
    }
  }

  return { ok: true, checked, sent, skipped };
}
