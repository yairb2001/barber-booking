/**
 * Link-first mode — a token-saving customer flow (opt-in per business via
 * `settings.linkFirstEnabled`).
 *
 * Instead of running the (paid) AI agent on every incoming message, a business
 * can choose to:
 *   1. On the FIRST contact of a new conversation → reply with a FIXED greeting
 *      + booking link (0 tokens). The agent stays out.
 *   2. From the customer's NEXT message on → the agent takes over and books.
 *   3. 30 minutes later, if the customer NEITHER replied NOR booked → send ONE
 *      fixed "let's find you a time" nudge (0 tokens). See runLinkNudges().
 *   4. Still nothing → the existing conversation-followup cron nudges later.
 *
 * Every message sent here is also written into the customer's Conversation, so
 * it shows in /admin/chats AND becomes context for the agent's next run.
 */
import { prisma } from "@/lib/prisma";
import { sendMessage, firstName } from "@/lib/messaging";
import type { MessageKind } from "@/lib/messaging/types";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { getRootBusinessId } from "@/lib/tenant";
import { getBusinessNow } from "@/lib/utils";
import { DEFAULT_GREETING_TEMPLATE, DEFAULT_NUDGE_TEMPLATE, DEFAULT_REGREET_DAYS } from "@/lib/link-first-defaults";
import { isPhoneLikeName } from "@/lib/agent/followup-shared";

/**
 * Resolve the name to address the customer with (owner's rule):
 *   1. the REGISTERED customer name (they told us who they are),
 *   2. else the WhatsApp profile name,
 *   3. else NO name at all — and never a phone-like "name" (some profiles have
 *      no name and the pushname arrives as the raw number; addressing a customer
 *      by their phone number happened once and looked terrible).
 */
async function resolveCustomerName(
  businessId: string,
  phone: string,
  whatsappName?: string | null,
): Promise<string | null> {
  const normalized = normalizeIsraeliPhone(phone) || phone;
  const localPhone = normalized.startsWith("972") ? "0" + normalized.slice(3) : normalized;
  const customer = await prisma.customer.findFirst({
    where: { businessId, deletedAt: null, OR: [{ phone: normalized }, { phone: localPhone }] },
    select: { name: true },
    orderBy: { createdAt: "asc" },
  });
  if (customer?.name && !isPhoneLikeName(customer.name)) return customer.name;
  if (whatsappName && !isPhoneLikeName(whatsappName)) return whatsappName;
  return null;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";

// ── Settings ─────────────────────────────────────────────────────────────────
type LinkFirstSettings = {
  linkFirstEnabled?: boolean;
  linkFirstGreeting?: string;   // optional override, supports {{link}} / {{name}}
  linkNudgeText?: string;       // optional override, supports {{link}} / {{name}}
  linkFirstRegreetDays?: number; // re-send the greeting only if no greeting in the last N days
};

function parseSettings(settings: string | null | undefined): LinkFirstSettings {
  if (!settings) return {};
  try { return JSON.parse(settings) as LinkFirstSettings; } catch { return {}; }
}

export function isLinkFirstEnabled(settings: string | null | undefined): boolean {
  return parseSettings(settings).linkFirstEnabled === true;
}

export function regreetDays(settings: string | null | undefined): number {
  const v = parseSettings(settings).linkFirstRegreetDays;
  return typeof v === "number" && v >= 0 ? v : DEFAULT_REGREET_DAYS;
}

/**
 * Should this incoming message get the fixed greeting (vs. the AI agent)?
 * The rule (set by the owner): the greeting fires ONLY on a FRESH contact —
 *   (a) a brand-new conversation, or
 *   (b) the thread was quiet for at least the re-greet window, measured from the
 *       LAST message in the conversation regardless of who sent it
 *       (prevLastMessageAt is captured BEFORE the incoming message is persisted).
 * A customer replying to yesterday's follow-up is NOT fresh — the agent answers.
 *
 * Defense-in-depth: also require no greeting_link within the window. The
 * MessageLog survives the 3-day conversation cleanup, so a wiped thread can't
 * cause a re-greet inside the cooldown.
 */
export async function shouldSendGreeting(
  businessId: string,
  phone: string,
  settings: string | null | undefined,
  prevLastMessageAt: Date | null,
): Promise<boolean> {
  const days = regreetDays(settings);
  const windowMs = days * 24 * 60 * 60 * 1000;

  // Active thread — someone said something within the window → not fresh.
  if (prevLastMessageAt && Date.now() - prevLastMessageAt.getTime() < windowMs) {
    return false;
  }

  const normalized = normalizeIsraeliPhone(phone) || phone;
  const localPhone = normalized.startsWith("972") ? "0" + normalized.slice(3) : normalized;

  // A customer with an UPCOMING appointment — or one who visited in the last few
  // days — is mid-relationship, not a cold lead. Their messages are operational
  // ("אני 5 דק מגיע", "תודה, היה מעולה") and pitching them a booking link is
  // exactly the tone-deaf reply the owner flagged (real incident: אור יוסופון
  // announced he's arriving in 5 minutes and got the automation). The AGENT
  // handles them — it sees their appointment in its context.
  const RECENT_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const recentOrUpcoming = await prisma.appointment.findFirst({
    where: {
      businessId,
      date: { gte: new Date(Date.now() - RECENT_DAYS_MS) },
      status: { notIn: ["cancelled_by_customer", "cancelled_by_staff"] },
      customer: { phone: { in: [normalized, localPhone] } },
    },
    select: { id: true },
  });
  if (recentOrUpcoming) return false;

  const since = new Date(Date.now() - windowMs);
  const recent = await prisma.messageLog.findFirst({
    where: { businessId, customerPhone: normalized, kind: "greeting_link", createdAt: { gte: since } },
    select: { id: true },
  });
  return !recent;
}

// ── First-contact intent (what does the fresh message actually want?) ────────
export type FirstContactIntent = "book" | "chat" | "other";

/**
 * True when the message is written in a language other than Hebrew (has letters,
 * none of them Hebrew). The fixed greeting/nudge are Hebrew-only, so a customer
 * writing in English must go to the AGENT, which mirrors their language (real
 * incident: an English "do you have any openings?" got the Hebrew automation).
 */
export function isNonHebrewMessage(text: string): boolean {
  const hasHebrew = /[א-ת]/.test(text);
  const hasLetters = /[a-zA-Zа-яА-Я؀-ۿ]/.test(text);
  return hasLetters && !hasHebrew;
}

/**
 * Classify a FRESH contact's first message so the automation is sent only when
 * it fits (owner's rule):
 *   book  → wants to schedule → send the greeting+link, no agent.
 *   chat  → greeting/small talk, no concrete request → agent replies naturally,
 *           then the automation is sent right after.
 *   other → a concrete NON-booking request (cancel, move, question, complaint)
 *           → NO automation; the agent handles it.
 * One tiny Haiku call (~a few dozen tokens) — still far cheaper than running the
 * full agent on every first contact. Falls back to "book" on error so the
 * customer at least gets the link instead of silence.
 */
export async function classifyFirstContactIntent(text: string): Promise<FirstContactIntent> {
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 5,
      system:
        "סווג את ההודעה הראשונה של לקוח למספרה לקטגוריה אחת בדיוק. " +
        "ענה במילה אחת בלבד: " +
        "book = רוצה לקבוע תור חדש / שואל על זמינות או תור פנוי. " +
        "chat = ברכה או סמול-טוק בלבד, בלי שום תוכן נוסף (היי, מה קורה, בוקר טוב). " +
        "other = כל דבר אחר. כולל: הודעה תפעולית על תור קיים (אני בדרך, אני מגיע עוד 5 דקות, אני מאחר, הגעתי), " +
        "תודה או פידבק אחרי ביקור (תודה, היה מעולה), ביטול, הזזה/שינוי/דחיית תור, שאלה על מחיר/שעות/כתובת, תלונה, " +
        "בקשה לדבר עם מישהו, או כל בקשה שאינה קביעת תור חדש. " +
        "אם יש ספק בין book ל-other — בחר other.",
      messages: [{ role: "user", content: text.slice(0, 500) }],
    });
    let out = "";
    for (const b of res.content) if (b.type === "text") out += b.text;
    const word = out.trim().toLowerCase();
    if (word.startsWith("chat")) return "chat";
    if (word.startsWith("other")) return "other";
    return "book";
  } catch (e) {
    console.error("[link-first] intent classification failed:", e);
    return "book";
  }
}

// ── Booking link ─────────────────────────────────────────────────────────────
/**
 * Public storefront URL for this business. The ROOT/legacy business lives at the
 * bare domain ("/"); every other tenant at "/<slug>". Mirrors the publicPath
 * logic used across the admin UI.
 */
export async function buildBookingLink(biz: { id: string; slug: string | null }): Promise<string> {
  const rootId = await getRootBusinessId();
  const isRoot = biz.id === rootId;
  return `${APP_URL}${isRoot || !biz.slug ? "" : `/${biz.slug}`}`;
}

// ── Message text (fixed defaults, owner-overridable) ──────────────────────────
function applyVars(tpl: string, link: string, name: string | null): string {
  let out = tpl.replace(/\{\{\s*link\s*\}\}/g, link);
  const first = name ? firstName(name) : "";
  if (first) {
    out = out.replace(/\{\{\s*name\s*\}\}/g, first);
  } else {
    // No name (a WhatsApp sender without a profile name). Remove the placeholder
    // AND any tight wrapper the owner put around it — "(…)", "[…]", " -" — so we
    // never render "היי ()" or "היי -". Then tidy the leftover spacing.
    out = out
      .replace(/[([{]\s*\{\{\s*name\s*\}\}\s*[)\]}]/g, "")
      .replace(/[-–—]\s*\{\{\s*name\s*\}\}/g, "")
      .replace(/\{\{\s*name\s*\}\}/g, "")
      .replace(/[ \t]{2,}/g, " ")   // collapse double spaces
      .replace(/[ \t]+([,.!?])/g, "$1") // drop space before punctuation
      .replace(/[ \t]+\n/g, "\n");  // drop trailing spaces at line end
  }
  return out;
}

export function greetingText(settings: string | null | undefined, link: string, name: string | null): string {
  const override = parseSettings(settings).linkFirstGreeting;
  const tpl = override && override.trim() ? override : DEFAULT_GREETING_TEMPLATE;
  return applyVars(tpl, link, name);
}

export function nudgeText(settings: string | null | undefined, link: string, name: string | null): string {
  const override = parseSettings(settings).linkNudgeText;
  const tpl = override && override.trim() ? override : DEFAULT_NUDGE_TEMPLATE;
  return applyVars(tpl, link, name);
}

// ── Send a fixed message into the customer conversation ───────────────────────
/**
 * Persist a fixed (non-AI) message into the customer's conversation and send it.
 * Does NOT escalate — the agent must still answer the customer's next message.
 * The ConversationMessage makes it visible in /admin/chats and part of the
 * agent's transcript context.
 */
async function sendFixedToConversation(opts: {
  businessId: string;
  phone: string;
  body: string;
  kind: MessageKind;
  name?: string | null;
}): Promise<void> {
  const normalized = normalizeIsraeliPhone(opts.phone) || opts.phone;

  let conv = await prisma.conversation.findFirst({
    where: { businessId: opts.businessId, phone: normalized, agentType: { not: "owner" } },
    orderBy: { createdAt: "desc" },
  });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: {
        businessId: opts.businessId,
        phone: normalized,
        agentType: "customer",
        status: "active",
        lastMessageAt: new Date(),
        ...(opts.name ? { whatsappName: opts.name } : {}),
      },
    });
  }

  await prisma.conversationMessage.create({
    data: { conversationId: conv.id, role: "assistant", source: "agent", content: opts.body },
  });
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), lastReadAt: new Date() },
  });

  await sendMessage({ businessId: opts.businessId, customerPhone: normalized, kind: opts.kind, body: opts.body });
}

/** First-contact greeting + booking link. Called from the webhook. */
export async function sendGreetingLink(biz: { id: string; slug: string | null; settings: string | null }, phone: string, whatsappName?: string | null): Promise<void> {
  const link = await buildBookingLink(biz);
  // Registered name → WhatsApp name → none (never a phone-like string).
  const name = await resolveCustomerName(biz.id, phone, whatsappName);
  const body = greetingText(biz.settings, link, name);
  await sendFixedToConversation({ businessId: biz.id, phone, body, kind: "greeting_link", name: whatsappName });
}

// ── 30-min "didn't book / didn't reply" nudge ────────────────────────────────
const NUDGE_AFTER_MS = 30 * 60 * 1000;       // wait 30 min after the greeting
const NUDGE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // ...but don't nudge greetings older than 6h
const SEND_FROM_HOUR = 9;
const SEND_TO_HOUR = 21;

function israelHour(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return h === 24 ? 0 : h;
}

/**
 * Scan for link-first greetings sent 30 min – 6 h ago whose customer NEITHER
 * replied NOR booked, and send them ONE fixed nudge. Idempotent (deduped via a
 * `link_nudge` MessageLog). Safe to call frequently — piggybacked on the
 * every-minute drip-queue cron, so no dedicated scheduler is needed.
 */
export async function runLinkNudges(): Promise<{ checked: number; sent: number }> {
  const now = Date.now();
  // Quiet hours — never nudge outside 09:00–21:00 Israel time.
  const hour = israelHour(new Date(now));
  if (hour < SEND_FROM_HOUR || hour >= SEND_TO_HOUR) return { checked: 0, sent: 0 };

  const greetings = await prisma.messageLog.findMany({
    where: {
      kind: "greeting_link",
      createdAt: { gte: new Date(now - NUDGE_MAX_AGE_MS), lte: new Date(now - NUDGE_AFTER_MS) },
    },
    select: { businessId: true, customerPhone: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Today's date (business tz) for the "already has an upcoming appointment" check.
  const todayDate = new Date(getBusinessNow().date + "T00:00:00.000Z");
  const CANCELLED = ["cancelled_by_customer", "cancelled_by_staff", "no_show"];

  let sent = 0;
  const seen = new Set<string>();
  // Anti-blast: at most ONE proactive nudge per business per run. Others stay
  // candidates for the next pass (~2 min later), so a backlog drips out slowly
  // instead of firing a burst that WhatsApp could flag.
  const nudgedBusinesses = new Set<string>();
  for (const g of greetings) {
    const key = `${g.businessId}|${g.customerPhone}`;
    if (seen.has(key)) continue; // one nudge per phone per run
    seen.add(key);
    if (nudgedBusinesses.has(g.businessId)) continue;

    const biz = await prisma.business.findUnique({
      where: { id: g.businessId },
      select: { id: true, slug: true, settings: true },
    });
    if (!biz || !isLinkFirstEnabled(biz.settings)) continue; // toggled off since

    const phone = g.customerPhone; // stored normalized (972…)
    const localPhone = phone.startsWith("972") ? "0" + phone.slice(3) : phone;

    // Already nudged for this greeting?
    const alreadyNudged = await prisma.messageLog.findFirst({
      where: { businessId: biz.id, customerPhone: phone, kind: "link_nudge", createdAt: { gte: g.createdAt } },
      select: { id: true },
    });
    if (alreadyNudged) continue;

    // Did the customer REPLY after the greeting? → the agent is handling them.
    const conv = await prisma.conversation.findFirst({
      where: { businessId: biz.id, phone, agentType: { not: "owner" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, whatsappName: true },
    });
    if (conv) {
      const reply = await prisma.conversationMessage.findFirst({
        where: { conversationId: conv.id, role: "user", createdAt: { gt: g.createdAt } },
        select: { id: true },
      });
      if (reply) continue;
    }

    // Did they BOOK? Any upcoming appointment OR any appointment created after
    // the greeting (covers a same-day slot that already ended by nudge time).
    const upcoming = await prisma.appointment.findFirst({
      where: {
        businessId: biz.id,
        status: { notIn: CANCELLED },
        customer: { phone: { in: [phone, localPhone] } },
        OR: [
          { date: { gte: todayDate } },
          { createdAt: { gte: g.createdAt } },
        ],
      },
      select: { id: true },
    });
    if (upcoming) continue;

    const link = await buildBookingLink(biz);
    // Registered name → WhatsApp name → none (never a phone-like string).
    const name = await resolveCustomerName(biz.id, phone, conv?.whatsappName);
    const body = nudgeText(biz.settings, link, name);
    await sendFixedToConversation({ businessId: biz.id, phone, body, kind: "link_nudge", name: conv?.whatsappName });
    nudgedBusinesses.add(biz.id);
    sent++;
  }

  return { checked: greetings.length, sent };
}
