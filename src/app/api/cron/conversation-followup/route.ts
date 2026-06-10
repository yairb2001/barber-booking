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

export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const MIN_QUIET_MS = 60 * 60 * 1000;        // wait at least 1h after the last message
const MAX_AGE_MS   = 30 * 60 * 60 * 1000;   // don't chase chats older than ~30h

function fallbackFollowup(name: string | null): string {
  const hi = name ? `היי ${name}, ` : "היי, ";
  return `${hi}ראיתי שהתחלנו ולא סגרנו תור — רוצה שאמצא לך שעה טובה?`;
}

/** Write one short, contextual nudge from the conversation so far. */
async function generateFollowup(transcript: string, name: string | null): Promise<string> {
  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      system:
        "אתה נציג מספרה שמתכתב בוואטסאפ. הלקוח התחיל שיחה ולא סגר תור, ואתה שולח לו הודעת פולואפ אחת קצרה. " +
        "כתוב משפט אחד חם וטבעי בעברית שמחזיר אותו לקבוע תור, בלי לחץ ובלי להישמע כמו בוט. " +
        "בלי ירידות שורה, כמעט בלי אימוג'ים, ובלי לחזור מילה במילה על מה שכבר נאמר. " +
        (name ? `פנה ללקוח בשמו (${name}). ` : "") +
        "החזר רק את ההודעה עצמה, בלי הקדמות.",
      messages: [
        { role: "user", content: `זו השיחה עד עכשיו:\n\n${transcript}\n\nכתוב הודעת פולואפ אחת.` },
      ],
    });
    let text = "";
    for (const b of res.content) if (b.type === "text") text += b.text;
    text = text.trim();
    return text || fallbackFollowup(name);
  } catch (e) {
    console.error("[followup] LLM failed", e);
    return fallbackFollowup(name);
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret =
    searchParams.get("secret") || req.headers.get("x-cron-secret") || "";
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now          = new Date();
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
          kind:          "agent_followup",
          createdAt:     { gte: notOlderThan },
        },
        select: { id: true },
      });
      if (already) { skipped++; continue; }

      // Customer already has an upcoming appointment → they booked, leave them be.
      const upcoming = await prisma.appointment.findFirst({
        where: {
          businessId: biz.id,
          date:       { gte: startOfToday },
          status:     { notIn: ["cancelled_by_customer", "cancelled_by_staff"] },
          customer:   { is: { OR: [{ phone }, { phone: localPhone }] } },
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

      // Name: prefer the linked customer, fall back to the WhatsApp display name.
      let name: string | null = convo.whatsappName ? firstName(convo.whatsappName) : null;
      if (convo.customerId) {
        const c = await prisma.customer.findUnique({
          where:  { id: convo.customerId },
          select: { name: true },
        });
        if (c?.name) name = firstName(c.name);
      }

      const followup = await generateFollowup(transcript, name);

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
