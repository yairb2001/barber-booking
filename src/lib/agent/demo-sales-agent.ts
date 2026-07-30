/**
 * Public demo widget (/for-business) sales follow-up.
 *
 * SEPARATE from the two production follow-ups (question-followup,
 * conversation-followup) — those chase real customers of real businesses
 * toward a real booking. This one runs ONLY against the demo business
 * (DEMO_BUSINESS_ID, "המספרה של דני") and has a different goal entirely: turn
 * someone who just played with the live agent demo into a sales lead.
 *
 * Two triggers (owner's spec, 2026-07-30):
 *   A. They finished a demo booking — a few minutes later, pitch them.
 *   B. They sent 4+ messages (more than 3) and then went quiet for ~1h.
 *
 * The pitch references what they actually tried in the demo (not a generic
 * "did you like it?"), and ends with a simple ask for a phone number — no
 * reply-parsing needed here: src/app/api/demo-chat/route.ts intercepts a
 * phone-number-shaped reply after a pitch was sent and captures it directly,
 * bypassing the booking agent entirely for that turn.
 *
 * Never touches any real business — every query below is scoped to
 * DEMO_BUSINESS_ID, and it writes nothing outside that business's own rows.
 */
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/** Trigger A: wait this long after a demo booking before pitching. */
const BOOKING_TRIGGER_DELAY_MS = 3 * 60 * 1000;
/** Trigger B: this much silence after their 4th+ message. */
const SILENCE_TRIGGER_MS = 60 * 60 * 1000;
/** Trigger B: "more than 3 messages" from their side. */
const MIN_USER_MESSAGES_FOR_SILENCE_TRIGGER = 4;
/** Don't chase a demo conversation that's gone stale (visitor long gone). */
const MAX_CONVERSATION_AGE_MS = 24 * 60 * 60 * 1000;

function fallbackPitch(): string {
  return "דרך אגב — זה בדיוק איך זה עובד אצל לקוחות אמיתיים. אם זה נראה לך שימושי לעסק שלך, מה השם שלך? נשמח לחזור אליך.";
}

/** Write one short, personalized pitch referencing what they actually tried in
 *  the demo. Returns null on total failure (falls back to a fixed line instead
 *  of skipping — unlike the customer-facing follow-ups, silence here is a lost
 *  sales opportunity, not a risk of bothering someone). */
async function generatePitch(transcript: string, reason: "booked" | "silence"): Promise<string> {
  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 250,
      system:
        "אתה עוזר לבעל פלטפורמת SaaS למספרות למכור את המערכת. מישהו בדיוק ניסה דמו חי של הסוכן (אותו סוכן AI שמנהל תורים בוואטסאפ), על מספרה בדיונית. " +
        "המטרה: לכתוב הודעת המשך אחת, קצרה וטבעית (לא פיץ' גנרי), שמתייחסת בדיוק למה שהוא ניסה או שאל בדמו (למשל אם ניסה לקבוע לכמה אנשים, ביטל, שאל על מחיר) ומראה שזה בדיוק מה שיעבוד לו בעסק האמיתי שלו. " +
        (reason === "booked"
          ? "הוא הרגע סיים לקבוע תור דמו בהצלחה — זה הזמן הכי טוב לפנות, כשהוא עוד רואה כמה זה חלק."
          : "הוא ניסה כמה הודעות ואז נעלם — תזכיר לו בעדינות, בלי לחץ.") +
        " סיים תמיד בשאלה קצרה וטבעית מה השם שלו, בלי לבקש מספר טלפון או פרטי קשר אחרים — רק שם. משפט אחד או שניים בלבד, בלי אימוג'ים מוגזמים, בעברית טבעית כמו הודעת וואטסאפ. החזר רק את ההודעה עצמה, בלי הקדמות.",
      messages: [
        { role: "user", content: `זו השיחה בדמו עד עכשיו:\n\n${transcript}\n\nכתוב את הודעת ההמשך.` },
      ],
    });
    let text = "";
    for (const b of res.content) if (b.type === "text") text += b.text;
    text = text.trim();
    return text || fallbackPitch();
  } catch (e) {
    console.error("[demo-sales-agent] LLM failed", e);
    return fallbackPitch();
  }
}

export async function runDemoSalesAgent(
  now: Date = new Date(),
): Promise<{ ok: true; checked: number; sent: number }> {
  const convos = await prisma.conversation.findMany({
    where: {
      businessId: DEMO_BUSINESS_ID,
      createdAt: { gte: new Date(now.getTime() - MAX_CONVERSATION_AGE_MS) },
    },
    select: { id: true, phone: true, createdAt: true },
  });
  if (!convos.length) return { ok: true, checked: 0, sent: 0 };

  let checked = 0, sent = 0;

  for (const convo of convos) {
    checked++;

    // Already pitched this session — never pitch twice.
    const already = await prisma.messageLog.findFirst({
      where: { businessId: DEMO_BUSINESS_ID, customerPhone: convo.phone, kind: "demo_sales_pitch" },
      select: { id: true },
    });
    if (already) continue;

    let reason: "booked" | "silence" | null = null;

    // Trigger A: finished a demo booking.
    const appt = await prisma.appointment.findFirst({
      where: { businessId: DEMO_BUSINESS_ID, customer: { phone: convo.phone } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (appt && now.getTime() - appt.createdAt.getTime() >= BOOKING_TRIGGER_DELAY_MS) {
      reason = "booked";
    }

    const msgs = await prisma.conversationMessage.findMany({
      where: { conversationId: convo.id, role: { in: ["user", "assistant"] } },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true, createdAt: true },
    });
    if (!msgs.length) continue;

    // Trigger B: 4+ messages from them, then ~1h of silence.
    if (!reason) {
      const userCount = msgs.filter(m => m.role === "user").length;
      const last = msgs[msgs.length - 1];
      if (
        userCount >= MIN_USER_MESSAGES_FOR_SILENCE_TRIGGER &&
        now.getTime() - last.createdAt.getTime() >= SILENCE_TRIGGER_MS
      ) {
        reason = "silence";
      }
    }
    if (!reason) continue;

    const transcript = msgs
      .map(m => `${m.role === "user" ? "מבקר" : "סוכן"}: ${m.content}`)
      .join("\n");
    const pitch = await generatePitch(transcript, reason);

    try {
      await prisma.conversationMessage.create({
        data: { conversationId: convo.id, role: "assistant", content: pitch },
      });
      await prisma.messageLog.create({
        data: {
          businessId: DEMO_BUSINESS_ID,
          customerPhone: convo.phone,
          kind: "demo_sales_pitch",
          body: pitch,
          status: "sent",
          sentAt: now,
        },
      });
      sent++;
    } catch (e) {
      console.error("[demo-sales-agent] write failed", convo.phone, e);
    }
  }

  return { ok: true, checked, sent };
}
