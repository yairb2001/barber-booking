/**
 * Onboarding nudge cron — chases an owner who stalled mid-onboarding.
 *
 * Cadence: 1h / 24h / 3d / weekly after that, capped at 5 total nudges. After
 * the 5th with no reply, stop and flag `onboardingStuckAt` (+ notify Yair) —
 * mirrors the "onboarding תקוע" flag from the spec. Quiet hours + LLM
 * SKIP-or-write pattern borrowed directly from conversation-followup.ts.
 *
 * Sends via the platform's own WhatsApp number (see onboarding-agent.ts for why).
 */
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { sendMessage, firstName } from "@/lib/messaging";
import { SUPER_ADMIN_BUSINESS_ID, notifyPlatformOwner } from "@/lib/super-admin";
import { nowLineIsrael } from "@/lib/agent/followup-shared";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Nudge cadence, indexed by how many nudges already went out (0 = never nudged).
const NUDGE_DELAYS_MS = [
  1 * 60 * 60 * 1000,       // 1h after going quiet → 1st nudge
  24 * 60 * 60 * 1000,      // 24h after the 1st nudge → 2nd
  3 * 24 * 60 * 60 * 1000,  // 3d after the 2nd → 3rd
  7 * 24 * 60 * 60 * 1000,  // weekly after that → 4th, 5th
  7 * 24 * 60 * 60 * 1000,
];
const MAX_NUDGES = NUDGE_DELAYS_MS.length;

const SEND_FROM_HOUR = 9;
const SEND_TO_HOUR = 21;
function israelHour(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find(p => p.type === "hour")?.value ?? "0");
  return h === 24 ? 0 : h;
}

function fallbackNudge(name: string | null): string {
  const hi = name ? `היי ${name}, ` : "היי, ";
  return `${hi}רק תזכורת קטנה — נשארו כמה שאלות קצרות כדי לגמור להגדיר את המערכת שלך. מתי נוח להמשיך?`;
}

async function generateNudge(transcript: string, name: string | null, touchNumber: number): Promise<string | null> {
  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      system:
        "אתה נציג של דומיננט, מערכת ניהול תורים למספרות. בעל עסק התחיל תהליך onboarding בוואטסאפ ונעצר באמצע, ואתה שוקל לשלוח לו תזכורת עדינה אחת לחזור ולסיים. " +
        nowLineIsrael() + " " +
        "אם הבעלים אמר במפורש שהוא לא מעוניין להמשיך / ביקש להפסיק לפנות אליו — החזר בדיוק את המילה SKIP. " +
        "אחרת: כתוב משפט אחד חם וקצר שמזמין אותו לחזור ולהמשיך בהגדרה, בלי לחץ. " +
        (touchNumber >= 4 ? "זו כבר פנייה מאוחרת (4 ומעלה) — היה עדין במיוחד, נימה של 'כשנוח לך, אנחנו כאן'. " : "") +
        "בלי ירידות שורה, כמעט בלי אימוג'ים. " +
        (name ? `פנה בשמו (${name}). ` : "אין שם — אל תשתמש בכינוי. ") +
        "החזר רק את ההודעה עצמה (או SKIP), בלי הקדמות.",
      messages: [
        { role: "user", content: `זו השיחה עד עכשיו:\n\n${transcript}\n\nהחלט: SKIP או תזכורת אחת קצרה.` },
      ],
    });
    let text = "";
    for (const b of res.content) if (b.type === "text") text += b.text;
    text = text.trim();
    if (!text) return fallbackNudge(name);
    if (/^SKIP\b/i.test(text)) return null;
    return text;
  } catch (e) {
    console.error("[onboarding-followup] LLM failed", e);
    return fallbackNudge(name);
  }
}

export async function runOnboardingFollowup(
  now: Date = new Date(),
): Promise<{ ok: true; checked: number; sent: number; stuck: number; skipped: number } | { ok: true; skipped: "quiet_hours"; israelHour: number }> {
  const hour = israelHour(now);
  if (hour < SEND_FROM_HOUR || hour >= SEND_TO_HOUR) {
    return { ok: true, skipped: "quiet_hours", israelHour: hour };
  }

  const businesses = await prisma.business.findMany({
    where: {
      onboardingStartedAt: { not: null },
      onboardingCompletedAt: null,
      onboardingStuckAt: null,
      id: { not: SUPER_ADMIN_BUSINESS_ID },
    },
    select: {
      id: true, name: true, phone: true, settings: true,
      onboardingNudgeCount: true, onboardingLastNudgeAt: true,
    },
  });

  let checked = 0, sent = 0, stuck = 0, skipped = 0;

  for (const biz of businesses) {
    checked++;
    if (!biz.phone) { skipped++; continue; }

    const nudgeCount = biz.onboardingNudgeCount;
    if (nudgeCount >= MAX_NUDGES) {
      // Shouldn't normally get here (stuck flag is set below on the 5th nudge),
      // but guard anyway.
      await prisma.business.update({ where: { id: biz.id }, data: { onboardingStuckAt: now } });
      await notifyPlatformOwner(`⚠️ onboarding תקוע (ללא נדג' זמין): ${biz.name}, ${biz.phone}`);
      stuck++;
      continue;
    }

    const conv = await prisma.conversation.findFirst({
      where: { businessId: biz.id, agentType: "onboarding" },
      orderBy: { createdAt: "desc" },
      select: { id: true, lastMessageAt: true, escalatedAt: true, whatsappName: true },
    });
    if (!conv || !conv.lastMessageAt || conv.escalatedAt) { skipped++; continue; }

    // Wait the right delay since the LAST touch (either the owner's last
    // message, or our last nudge — whichever is more recent).
    const sinceMs = now.getTime() - Math.max(
      conv.lastMessageAt.getTime(),
      biz.onboardingLastNudgeAt?.getTime() ?? 0,
    ).valueOf();
    if (sinceMs < NUDGE_DELAYS_MS[nudgeCount]) { skipped++; continue; }

    const msgs = await prisma.conversationMessage.findMany({
      where: { conversationId: conv.id, role: { in: ["user", "assistant"] } },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { role: true, content: true },
    });
    if (!msgs.length) { skipped++; continue; }
    const transcript = [...msgs].reverse().map(m => `${m.role === "user" ? "בעל עסק" : "סוכן"}: ${m.content}`).join("\n");

    let name: string | null = null;
    const settings = biz.settings ? (JSON.parse(biz.settings) as Record<string, unknown>) : {};
    if (typeof settings.ownerName === "string") name = firstName(settings.ownerName);
    else if (conv.whatsappName) name = firstName(conv.whatsappName);

    const nudge = await generateNudge(transcript, name, nudgeCount + 1);
    if (nudge === null) { skipped++; continue; }

    try {
      await prisma.conversationMessage.create({
        data: { conversationId: conv.id, role: "assistant", content: nudge },
      });
      await sendMessage({
        businessId: biz.id, senderBusinessId: SUPER_ADMIN_BUSINESS_ID,
        customerPhone: biz.phone, kind: "onboarding_nudge", body: nudge,
      });
      const newCount = nudgeCount + 1;
      await prisma.business.update({
        where: { id: biz.id },
        data: {
          onboardingNudgeCount: newCount,
          onboardingLastNudgeAt: now,
          ...(newCount >= MAX_NUDGES ? { onboardingStuckAt: now } : {}),
        },
      });
      if (newCount >= MAX_NUDGES) {
        await notifyPlatformOwner(`⚠️ onboarding תקוע אחרי ${MAX_NUDGES} תזכורות ללא מענה: ${biz.name}, ${biz.phone}`);
        stuck++;
      }
      sent++;
    } catch (e) {
      console.error("[onboarding-followup] send failed", biz.id, e);
      skipped++;
    }
  }

  return { ok: true, checked, sent, stuck, skipped };
}
