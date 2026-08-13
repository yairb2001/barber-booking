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
 * The pitch is delivered as TWO short bubbles, like a real WhatsApp salesperson
 * (owner's spec, 2026-07-30) — not one paragraph:
 *   1. A concrete callback to what they actually did/tried in the demo.
 *   2. A pain-point question about manually handling WhatsApp, closing with an
 *      assumptive ask for their name (not a yes/no "does this interest you?" —
 *      the name request IS the close).
 * No phone number is requested. A reply after the pitch is captured directly
 * in src/app/api/demo-chat/route.ts (as a name, unless it reads as an explicit
 * decline) — bypassing the booking agent entirely for that turn.
 *
 * Never touches any real business — every query below is scoped to
 * DEMO_BUSINESS_ID, and it writes nothing outside that business's own rows.
 */
import Anthropic from "@anthropic-ai/sdk";
import { recordAgentUsage } from "@/lib/agent/usage";
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

function fallbackPitch(): string[] {
  return [
    "דרך אגב — זה בדיוק איך זה עובד אצל לקוחות אמיתיים.",
    "רוצה לראות איך זה נראה בדיוק אצלך בעסק? תגיד לי איך קוראים לך ונחזור אליך היום.",
  ];
}

/** Write a two-bubble pitch grounded in what they actually tried in the demo.
 *  Falls back to a fixed two-bubble line on total LLM failure instead of
 *  skipping — unlike the customer-facing follow-ups, silence here is a lost
 *  sales opportunity, not a risk of bothering someone. */
async function generatePitch(transcript: string, reason: "booked" | "silence"): Promise<string[]> {
  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      system:
        "אתה כותב הודעת המשך בשם בעל פלטפורמת SaaS למספרות, אחרי שמישהו ניסה דמו חי של הסוכן (אותו סוכן AI שמנהל תורים בוואטסאפ) על מספרה בדיונית. " +
        "כתוב בדיוק שתי הודעות (בועות), מופרדות בשורה ריקה ביניהן — כמו שתי הודעות וואטסאפ נפרדות, לא בלוק טקסט אחד:\n" +
        "הודעה 1: התייחסות קונקרטית וספציפית למה שהוא בפועל עשה או ניסה בדמו (לפי השיחה למטה — למשל אם קבע תור לשירות מסוים אצל ספר מסוים בשעה מסוימת, תגיד בדיוק את זה: 'ככה הסוכן קבע לך תור אצל X ביום Y בשעה Z'; אם רק שאל שאלה בלי לקבוע, התייחס לזה בלבד — אל תמציא שהוא קבע תור אם לא קבע). " +
        (reason === "booked"
          ? "הוא הרגע סיים לקבוע תור דמו בהצלחה — זה הזמן הכי טוב לפנות, כשהוא עוד רואה כמה זה חלק."
          : "הוא ניסה כמה הודעות ואז נעלם — תזכיר לו בעדינות, בלי לחץ.") +
        "\nהודעה 2: שאלת כאב טבעית על ניהול וואטסאפ ידני (למשל אם הוא עונה בעצמו כל היום ללקוחות למרות שיש לו מערכת), ואז סגירה אחת שמניחה עניין ומבקשת ישירות את השם שלו כדי לחזור אליו — לא לשאול 'מעניין אותך?' בנפרד, השם עצמו הוא הבקשה. " +
        "אל תמציא פיצ'רים, מחירים או יכולות שלא הוצגו בפועל בדמו — אתה לא יודע מחיר או תנאים, אל תבטיח שום דבר מספרי, רק תדבר על מה שהוא בעצמו ראה עובד. " +
        "בלי לבקש מספר טלפון או פרטי קשר אחרים — רק שם. בעברית טבעית כמו הודעת וואטסאפ אמיתית, בלי אימוג'ים מוגזמים, בלי בולד/כוכביות. החזר רק את שתי ההודעות מופרדות בשורה ריקה ביניהן, בלי הקדמות.",
      messages: [
        { role: "user", content: `זו השיחה בדמו עד עכשיו:\n\n${transcript}\n\nכתוב את שתי הודעות ההמשך.` },
      ],
    });
    void recordAgentUsage({ businessId: DEMO_BUSINESS_ID, provider: "anthropic", model: "claude-haiku-4-5", kind: "demo_sales", usage: res.usage });
    let text = "";
    for (const b of res.content) if (b.type === "text") text += b.text;
    const bubbles = text.trim().split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
    return bubbles.length ? bubbles : fallbackPitch();
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
    const bubbles = await generatePitch(transcript, reason);

    try {
      for (const bubble of bubbles) {
        await prisma.conversationMessage.create({
          data: { conversationId: convo.id, role: "assistant", content: bubble },
        });
      }
      await prisma.messageLog.create({
        data: {
          businessId: DEMO_BUSINESS_ID,
          customerPhone: convo.phone,
          kind: "demo_sales_pitch",
          body: bubbles.join("\n\n"),
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
