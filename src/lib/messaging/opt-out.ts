/**
 * Messaging opt-out ("הסר") — a customer asking to stop receiving anything we
 * initiate (broadcasts, reengage/post-visit automations, manual staff
 * messages). Unlike Customer.isBlocked this does NOT stop the agent from
 * replying or the customer from booking — see the schema comment on
 * Customer.messagingOptOut for the full contract. Cleared automatically the
 * next time an appointment is created for them (see the three booking
 * routes' `messagingOptOut: false` update).
 *
 * Two entry points feed the same DB update:
 *   1. This exact-keyword fast path — deterministic, runs before the agent,
 *      so a clear "הסר" always works even if the AI is confused/erroring.
 *   2. The `opt_out_of_messages` agent tool, for less literal phrasing
 *      ("תפסיק לשלוח לי הודעות") the model recognizes mid-conversation.
 */
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { phoneVariants } from "@/lib/messaging/phone";
import { pushToOwner } from "@/lib/native/push";

const EXACT_OPT_OUT_PHRASES = new Set([
  "הסר", "הסרה", "הסר אותי", "הסר אותי בבקשה", "הסירו אותי", "תסירו אותי",
  "הסר אותי מרשימת התפוצה", "הסירו אותי מרשימת התפוצה", "בטל מנוי", "בטלו אותי",
  "תפסיקו לשלוח לי הודעות", "תפסיק לשלוח לי הודעות", "stop", "unsubscribe",
]);

export function isOptOutKeyword(text: string): boolean {
  const t = text.trim().replace(/[.\s!?״"]+$/g, "").toLowerCase();
  return EXACT_OPT_OUT_PHRASES.has(t);
}

/** Sets the opt-out flag + a fixed confirmation reply. Shared by the keyword
 *  fast path and the agent tool so both behave identically. */
export async function applyMessagingOptOut(opts: {
  businessId: string;
  phone: string;
  conversationId: string;
}): Promise<{ ok: boolean; alreadyOptedOut: boolean }> {
  const customer = await prisma.customer.findFirst({
    where: { businessId: opts.businessId, phone: { in: phoneVariants(opts.phone) }, deletedAt: null },
    select: { id: true, name: true, messagingOptOut: true },
  });
  if (!customer) return { ok: false, alreadyOptedOut: false };

  const alreadyOptedOut = customer.messagingOptOut;
  if (!alreadyOptedOut) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { messagingOptOut: true, messagingOptOutAt: new Date() },
    });
    pushToOwner(opts.businessId, {
      title: `🔕 ${customer.name} הסיר את עצמו מהודעות`,
      body: "לא יקבל יותר תפוצות/אוטומציות — ימשיך לקבל תזכורות לתורים קיימים.",
      data: { type: "chat", conversationId: opts.conversationId, phone: opts.phone },
    }).catch(() => {});
  }
  return { ok: true, alreadyOptedOut };
}

const OPT_OUT_CONFIRM_MSG =
  "בסדר, לא נשלח לך יותר הודעות תפוצה או תזכורות יזומות מאיתנו 🙏\n" +
  "אם יש לך תור קבוע — עדיין תקבל עליו תזכורת רגילה. ותמיד אפשר לחזור ולקבוע תור כשתרצה.";

/**
 * Deterministic fast path — an EXACT unsubscribe phrase, matched before the
 * agent even runs. Returns true when handled (webhook must stop, not call
 * the agent).
 */
export async function handleOptOutKeywordReply(
  biz: { id: string },
  phone: string,
  text: string,
  conversationId: string
): Promise<boolean> {
  if (!isOptOutKeyword(text)) return false;

  const result = await applyMessagingOptOut({ businessId: biz.id, phone, conversationId });
  if (!result.ok) return false; // unknown phone — nothing to opt out, let the agent handle it normally

  await prisma.conversationMessage.create({
    data: { conversationId, role: "assistant", content: OPT_OUT_CONFIRM_MSG },
  });
  await sendMessage({ businessId: biz.id, customerPhone: phone, kind: "manual", body: OPT_OUT_CONFIRM_MSG });
  return true;
}
