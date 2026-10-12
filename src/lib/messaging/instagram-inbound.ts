/**
 * Instagram webhook events → the chat inbox (step 4: the skeleton, no agent).
 *
 * Only for a business whose settings.instagram is { igUserId, enabled: true };
 * any other account's events are just logged by the route, as in the
 * connection experiment.
 *
 *   customer DM               → saved in the conversation `ig:<IGSID>` + a push
 *   echo of what WE sent      → ignored (matched by Meta's message id, or by
 *                               text against what we sent in the last 2 minutes)
 *   echo typed in the IG app  → saved as a human reply, and the conversation's
 *                               agent steps back for 24h (like a WhatsApp reply
 *                               typed on the phone)
 *   reads, reactions, buttons → nothing yet
 */
import { prisma } from "@/lib/prisma";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { pushToOwner } from "@/lib/native/push";
import { businessForInstagramAccount, igKey, instagramProfileName, plainForInstagram } from "./instagram";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");

/** Media and shares the inbox can't show yet: a short label, like the WhatsApp inbox does. */
function attachmentLabel(msg: Obj): string | null {
  const atts = Array.isArray(msg.attachments) ? msg.attachments.filter(isObj) : [];
  const t = atts.length ? str(atts[0].type) : "";
  switch (t) {
    case "image": return "📷 תמונה";
    case "video": return "🎥 סרטון";
    case "audio": return "🎤 הודעה קולית";
    case "file": return "📎 קובץ";
    case "share": case "ig_reel": case "reel": case "ig_post": return "🔗 שיתוף פוסט";
    case "story_mention": return "📣 תייג אותנו בסטורי";
    case "": return null;
    default: return "📎 הודעה שאינסטגרם לא מעביר כטקסט";
  }
}

function messageText(msg: Obj): string | null {
  const text = str(msg.text).trim();
  const label = text ? null : attachmentLabel(msg);
  const body = text || label;
  if (!body) return msg.is_unsupported === true ? "📎 הודעה שאינסטגרם לא מעביר כטקסט" : null;
  const toStory = isObj(msg.reply_to) && isObj(msg.reply_to.story);
  return toStory ? `↩️ תגובה לסטורי: ${body}` : body;
}

export async function handleInstagramWebhook(body: unknown): Promise<void> {
  if (!isObj(body) || body.object !== "instagram" || !Array.isArray(body.entry)) return;
  for (const entry of body.entry) {
    if (!isObj(entry) || !Array.isArray(entry.messaging)) continue;
    const biz = await businessForInstagramAccount(str(entry.id));
    if (!biz?.account.enabled) continue;
    for (const ev of entry.messaging) {
      if (!isObj(ev) || !isObj(ev.message) || ev.message.is_deleted === true) continue;
      try {
        if (ev.message.is_echo === true) await handleEcho(biz, ev);
        else await handleInbound(biz, ev);
      } catch (e) {
        console.error("[ig-inbound]", e);
      }
    }
  }
}

async function handleInbound(biz: { id: string; name: string; account: { igUserId: string } }, ev: Obj): Promise<void> {
  const msg = ev.message as Obj;
  const igsid = isObj(ev.sender) ? str(ev.sender.id) : "";
  if (!igsid || igsid === biz.account.igUserId) return;
  const text = messageText(msg);
  if (!text) return;
  const key = igKey(igsid);

  let conv = await prisma.conversation.findFirst({
    where: { businessId: biz.id, phone: key, agentType: { not: "owner" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, whatsappName: true },
  });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: { businessId: biz.id, phone: key, agentType: "customer", status: "active", lastMessageAt: new Date() },
      select: { id: true, whatsappName: true },
    });
  }

  // Meta re-sends an event it thinks we missed: the same text within a minute is that retry.
  const dup = await prisma.conversationMessage.findFirst({
    where: { conversationId: conv.id, role: "user", content: text, createdAt: { gte: new Date(Date.now() - 60_000) } },
    select: { id: true },
  });
  if (dup) return;

  const name = conv.whatsappName || (await instagramProfileName(igsid));
  await prisma.conversationMessage.create({ data: { conversationId: conv.id, role: "user", content: text } });
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date(), ...(name && !conv.whatsappName ? { whatsappName: name } : {}) },
  });

  // No agent on Instagram yet: every message waits for a person.
  const title = `הודעה חדשה באינסטגרם מ${name || "לקוח"}`;
  if (biz.id === DEMO_BUSINESS_ID) {
    const { recordCrmNotification } = await import("@/lib/crm/notify");
    await recordCrmNotification(`${title}\n${text.slice(0, 160)}`, { kind: "whatsapp", businessId: biz.id, href: `/admin/crm/chats/${conv.id}`, push: true }).catch(() => {});
  } else {
    await pushToOwner(biz.id, { title, body: text.slice(0, 160), data: { type: "chat", conversationId: conv.id, phone: key } }).catch(() => {});
  }
}

async function handleEcho(biz: { id: string }, ev: Obj): Promise<void> {
  const msg = ev.message as Obj;
  const igsid = isObj(ev.recipient) ? str(ev.recipient.id) : "";
  const text = messageText(msg);
  if (!igsid || !text) return;
  const key = igKey(igsid);
  const mid = str(msg.mid);

  // Ours: Meta's id is on the MessageLog row, or (when the echo beats our own
  // write) the same text went out to this chat in the last 2 minutes.
  const recent = await prisma.messageLog.findMany({
    where: { businessId: biz.id, customerPhone: key, createdAt: { gte: new Date(Date.now() - 120_000) } },
    select: { providerId: true, body: true },
  });
  const ours =
    recent.some(l => (mid && (l.providerId ?? "").includes(mid)) || plainForInstagram(l.body).includes(text)) ||
    (!!mid && (await prisma.messageLog.count({ where: { businessId: biz.id, providerId: { contains: mid } } })) > 0);
  if (ours) return;

  // Typed by a person in the Instagram app: show it, and the agent steps back for 24h.
  const conv = await prisma.conversation.findFirst({
    where: { businessId: biz.id, phone: key, agentType: { not: "owner" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!conv) return;
  await prisma.conversationMessage.create({ data: { conversationId: conv.id, role: "assistant", source: "admin", content: text } });
  await prisma.conversation.update({ where: { id: conv.id }, data: { escalatedAt: new Date(), lastMessageAt: new Date(), lastReadAt: new Date() } });
}
