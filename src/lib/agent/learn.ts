/**
 * How an agent learns a shop's small things (10.10.2026): an FAQ from the
 * owner's answer to a question it could not answer, a line in the shop's own
 * rules ("כללים של העסק"), or an approved proposal of the daily review.
 */
import { prisma } from "@/lib/prisma";
import { saveSetupAnswers, type SetupAuthor } from "@/lib/agent/setup-save";
import { centerNotify } from "@/lib/notify/center";
import { sendMessage, sendProactiveMessage } from "@/lib/messaging";
import { phoneVariants } from "@/lib/messaging/phone";
import { SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";

export async function addFaq(businessId: string, question: string, answer: string): Promise<string> {
  const cfg = await prisma.agentConfig.upsert({ where: { businessId }, create: { businessId }, update: {}, select: { id: true } });
  const last = await prisma.agentFAQ.findFirst({ where: { agentConfigId: cfg.id }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const faq = await prisma.agentFAQ.create({ data: { agentConfigId: cfg.id, question: question.trim().slice(0, 500), answer: answer.trim().slice(0, 1500), sortOrder: (last?.sortOrder ?? 0) + 1 }, select: { id: true } });
  return faq.id;
}

/** One more line in the shop's rules (setup answer businessRules), versioned like any setup change. */
export async function appendBusinessRule(businessId: string, rule: string, author: SetupAuthor): Promise<void> {
  const cfg = await prisma.agentConfig.findUnique({ where: { businessId }, select: { setupConfig: true } });
  let cur = "";
  try { cur = String((cfg?.setupConfig ? JSON.parse(cfg.setupConfig) : {}).businessRules ?? ""); } catch { cur = ""; }
  const line = rule.trim().replace(/\n+/g, " ");
  if (!line || cur.split("\n").some(l => l.trim() === line)) return;
  await saveSetupAnswers(businessId, { businessRules: (cur ? `${cur.trim()}\n` : "") + line }, author);
}

/**
 * The agent did not know (tool ask_owner). The question goes to the owner's
 * notification center (and push / WhatsApp, as he chose); the conversation is
 * NOT muted, the agent keeps helping with the rest.
 */
export async function askOwner(p: { businessId: string; conversationId: string | null; phone: string; question: string }): Promise<void> {
  // The same customer asking the same thing twice in a day is one question.
  const dup = await prisma.agentQuestion.findFirst({ where: { businessId: p.businessId, customerPhone: p.phone, status: "open", question: p.question, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } }, select: { id: true } });
  if (dup) return;
  const customer = await prisma.customer.findFirst({ where: { businessId: p.businessId, phone: { in: phoneVariants(p.phone) } }, select: { name: true } });
  const who = customer?.name?.trim() || p.phone.replace(/^972/, "0");
  const q = await prisma.agentQuestion.create({ data: { businessId: p.businessId, conversationId: p.conversationId, customerPhone: p.phone, customerName: customer?.name ?? null, question: p.question.slice(0, 500) }, select: { id: true } });
  const href = `/admin/notifications?q=${q.id}`;
  const { channel } = await centerNotify({ businessId: p.businessId, kind: "agent_question", title: `${who} שאל: ${p.question.slice(0, 120)}`, body: "מה לענות? התשובה תישלח אליו ותישמר לפעם הבאה.", href, meta: { questionId: q.id } });
  if (channel === "whatsapp") {
    const biz = await prisma.business.findUnique({ where: { id: p.businessId }, select: { phone: true, settings: true } });
    let owner = biz?.phone ?? null;
    try { const st = biz?.settings ? JSON.parse(biz.settings) : {}; if (typeof st.ownerLoginPhone === "string" && st.ownerLoginPhone) owner = st.ownerLoginPhone; } catch { /* ignore */ }
    const origin = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
    if (owner) await sendMessage({ businessId: SUPER_ADMIN_BUSINESS_ID, customerPhone: owner, kind: "agent_question", body: `❓ ${who} שאל את הסוכן: "${p.question.slice(0, 300)}"\nמה לענות? עונים כאן, והתשובה נשלחת אליו ונשמרת לפעם הבאה:\n${origin}${href}` }).catch(() => {});
  }
}

/** The owner answered: to the customer (from the shop's number), and kept as an FAQ unless he said not to. */
export async function answerQuestion(p: { businessId: string; questionId: string; answer: string; save: boolean; by: string }): Promise<{ ok: boolean; error?: string }> {
  const q = await prisma.agentQuestion.findUnique({ where: { id: p.questionId } });
  if (!q || q.businessId !== p.businessId) return { ok: false, error: "השאלה לא נמצאה" };
  if (q.status !== "open") return { ok: false, error: "כבר נענתה" };
  const answer = p.answer.trim();
  if (!answer) return { ok: false, error: "צריך לכתוב תשובה" };
  const sent = await sendProactiveMessage({ businessId: p.businessId, customerPhone: q.customerPhone, body: answer, kind: "owner_answer", escalate: false });
  const faqId = p.save ? await addFaq(p.businessId, q.question, answer) : null;
  await prisma.agentQuestion.update({ where: { id: q.id }, data: { status: "answered", answer, answeredBy: p.by, answeredAt: new Date(), faqId } });
  await prisma.businessNotification.updateMany({ where: { businessId: p.businessId, kind: "agent_question", meta: { contains: q.id } }, data: { doneAt: new Date(), readAt: new Date() } });
  return sent.ok ? { ok: true } : { ok: false, error: "נשמר, אבל ההודעה ללקוח לא יצאה. בדוק את חיבור הוואטסאפ." };
}
