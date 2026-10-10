/**
 * The daily agent review (10.10.2026, Yair: "קרון יומי שעובר על הלקוחות ומבין
 * אם יש שיפורים שצריך לעשות בפרומט ... כמובן מעדכן אותי לפני ב-CRM").
 *
 * Once a day, per business whose agent is on: yesterday's real conversations,
 * the owner's notes about the agent ("what I didn't like") and the questions
 * it could not answer go to one model call that proposes at most a few
 * concrete fixes. Proposals are stored (AgentImprovement, "pending") and Yair
 * gets ONE CRM notification for the whole run. Nothing changes in any agent
 * until he approves it in the CRM (src/app/admin/crm/improvements).
 */
import { prisma } from "@/lib/prisma";
import { anthropicFor } from "@/lib/anthropic-clients";
import { recordAgentUsage } from "@/lib/agent/usage";
import { recordCrmNotification } from "@/lib/crm/notify";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";

const MODEL = "claude-sonnet-4-6";
const MAX_CONVS = 12;
const MAX_MSGS = 16;

type Proposal = { kind: "rule" | "faq" | "setup" | "base"; title: string; proposal: string; evidence?: string; targetKey?: string };

const parse = (raw: string | null | undefined): Record<string, unknown> => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };

/** One business. Returns the proposals stored. */
export async function reviewBusiness(businessId: string, now = new Date(), opts: { sinceHours?: number } = {}): Promise<number> {
  const since = new Date(now.getTime() - (opts.sinceHours ?? 24) * 3600_000);
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true } });
  if (!biz) return 0;
  const cfg = await prisma.agentConfig.findUnique({ where: { businessId }, select: { setupConfig: true } });
  const setup = parse(cfg?.setupConfig);

  const [convs, feedback, questions, pending] = await Promise.all([
    prisma.conversation.findMany({
      where: { businessId, agentType: { not: "owner" }, lastMessageAt: { gte: since }, NOT: { phone: { startsWith: "972000" } }, messages: { some: { role: "assistant", source: "agent", createdAt: { gte: since } } } },
      orderBy: { lastMessageAt: "desc" }, take: MAX_CONVS, select: { id: true, escalatedAt: true },
    }),
    prisma.agentFeedback.findMany({ where: { businessId, status: "new" }, orderBy: { createdAt: "asc" }, take: 10 }),
    prisma.agentQuestion.findMany({ where: { businessId, createdAt: { gte: since } }, select: { question: true, answer: true, status: true }, take: 20 }),
    prisma.agentImprovement.findMany({ where: { businessId, status: "pending" }, select: { title: true, proposal: true } }),
  ]);
  if (!convs.length && !feedback.length) return 0;

  // Conversations the owner pointed at come first, in full.
  const ids = Array.from(new Set([...feedback.map(f => f.conversationId).filter((x): x is string => !!x), ...convs.map(c => c.id)])).slice(0, MAX_CONVS + 4);
  const transcripts: string[] = [];
  for (const id of ids) {
    const msgs = await prisma.conversationMessage.findMany({ where: { conversationId: id, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "desc" }, take: MAX_MSGS, select: { role: true, content: true, source: true } });
    if (msgs.length < 2) continue;
    const lines = msgs.reverse().map(m => `${m.role === "user" ? "לקוח" : m.source === "admin" ? "בעל העסק" : "סוכן"}: ${m.content.replace(/\s+/g, " ").slice(0, 300)}`);
    const esc = convs.find(c => c.id === id)?.escalatedAt ? " (הועברה לאדם)" : "";
    transcripts.push(`### שיחה ${id.slice(0, 8)}${esc}\n${lines.join("\n")}`);
  }

  const known = [
    setup.businessRules ? `כללים של העסק:\n${String(setup.businessRules)}` : "",
    setup.platformNotes ? `דברים אישיים (צוות צ'אטור):\n${String(setup.platformNotes)}` : "",
    pending.length ? `הצעות שכבר ממתינות (לא לחזור עליהן):\n${pending.map(p => `- ${p.title}: ${p.proposal}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");

  const system = `אתה בודק את הסוכן שעונה בוואטסאפ ללקוחות של "${biz.name}" (מספרה). קרא את שיחות היממה, את ההערות של בעל העסק ואת השאלות שהסוכן לא ידע, והצע עד 4 תיקונים קונקרטיים. רק מה שבאמת חשוב: טעות שחוזרת, משהו שבעל העסק התלונן עליו, שאלה שלקוחות שואלים ואין לסוכן תשובה, או התנהגות שמביכה את העסק. אם הכל טוב, החזר רשימה ריקה.

סוגי הצעות:
- "rule": כלל של העסק, שורה אחת שתיכנס לרשימת הכללים שלו (למשל "בשישי עד 14:00 רק תספורות").
- "faq": שאלה ותשובה שהסוכן צריך לדעת. proposal בפורמט "ש: ... ת: ...". רק אם התשובה ידועה מהשיחות או מבעל העסק; אחרת אל תמציא.
- "setup": שינוי תשובה לשאלת הגדרה קיימת. targetKey = מפתח השאלה (tone, emojis, address, defaultService, barberAssign, priceNote, cancelPolicy, walkin, location, payment, escalateWhen), proposal = הערך החדש.
- "base": בעיה כללית בהתנהגות הסוכן שלא קשורה לעסק הזה (תיקון בבסיס לכל העסקים). proposal = מה לשנות.

כל הצעה: title קצר בעברית, proposal מדויק, evidence = ציטוט קצר מהשיחה או מההערה שמראה את הבעיה. אל תציע דבר שכבר קיים בכללים או ממתין.
החזר JSON בלבד: {"proposals":[{"kind":"...","title":"...","proposal":"...","evidence":"...","targetKey":"..."}]}`;

  const user = [
    known,
    feedback.length ? `הערות של בעל העסק על הסוכן:\n${feedback.map(f => `- ${f.text}${f.conversationId ? ` (שיחה ${f.conversationId.slice(0, 8)})` : ""}`).join("\n")}` : "",
    questions.length ? `שאלות שהסוכן לא ידע:\n${questions.map(q => `- ${q.question}${q.answer ? ` → בעל העסק ענה: ${q.answer}` : ""}`).join("\n")}` : "",
    transcripts.join("\n\n"),
  ].filter(Boolean).join("\n\n");

  const res = await anthropicFor("prod").messages.create({ model: MODEL, max_tokens: 1500, system, messages: [{ role: "user", content: user.slice(0, 60000) }] });
  void recordAgentUsage({ businessId, provider: "anthropic", model: MODEL, kind: "review", usage: res.usage });
  const text = res.content.filter(b => b.type === "text").map(b => (b as { text: string }).text).join("");
  let proposals: Proposal[] = [];
  try { proposals = (JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { proposals?: Proposal[] }).proposals ?? []; } catch { proposals = []; }
  proposals = proposals.filter(p => p && ["rule", "faq", "setup", "base"].includes(p.kind) && p.title && p.proposal).slice(0, 4);

  for (const p of proposals) {
    await prisma.agentImprovement.create({ data: { businessId, source: feedback.length ? "feedback" : "daily_review", kind: p.kind, title: p.title.slice(0, 200), proposal: p.proposal.slice(0, 2000), evidence: p.evidence?.slice(0, 1000) ?? null, targetKey: p.kind === "setup" ? (p.targetKey ?? null) : null } });
  }
  if (feedback.length) await prisma.agentFeedback.updateMany({ where: { id: { in: feedback.map(f => f.id) } }, data: { status: "in_review", reviewedAt: now } });
  return proposals.length;
}

/** Every business with its agent on (the demo shop is reviewed through Chator's own agent, not here). */
export async function runDailyReview(now = new Date()): Promise<{ businesses: number; proposals: number; byBusiness: { name: string; n: number }[] }> {
  const on = await prisma.agentConfig.findMany({ where: { isEnabled: true, businessId: { not: DEMO_BUSINESS_ID } }, select: { businessId: true } });
  const byBusiness: { name: string; n: number }[] = [];
  let total = 0;
  for (const { businessId } of on) {
    try {
      const n = await reviewBusiness(businessId, now);
      if (n) {
        const b = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } });
        byBusiness.push({ name: b?.name ?? businessId, n });
        total += n;
      }
    } catch (e) { console.error("[daily-review]", businessId, e); }
  }
  if (total) {
    await recordCrmNotification(`הבדיקה היומית של הסוכנים: ${total} הצעות לשיפור\n${byBusiness.map(b => `${b.name} ${b.n}`).join(" · ")}`, { kind: "customer", href: "/admin/crm/improvements", push: true });
  }
  return { businesses: on.length, proposals: total, byBusiness };
}
