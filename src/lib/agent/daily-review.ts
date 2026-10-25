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
import { parseReports, type Report } from "@/lib/agent/fix-queue";

const MODEL = "claude-sonnet-4-6";
const MAX_CONVS = 12;
const MAX_MSGS = 16;

type Proposal = { kind: "rule" | "faq" | "setup" | "base"; title: string; proposal: string; evidence?: string; targetKey?: string; conv?: string };

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

כל הצעה: title קצר בעברית, proposal מדויק, evidence = ציטוט קצר מהשיחה או מההערה שמראה את הבעיה, conv = 8 התווים של השיחה שממנה הציטוט (כמו בכותרת "### שיחה ..."). אל תציע דבר שכבר קיים בכללים או ממתין.
החזר JSON בלבד: {"proposals":[{"kind":"...","title":"...","proposal":"...","evidence":"...","targetKey":"...","conv":"..."}]}`;

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
    await prisma.agentImprovement.create({ data: { businessId, source: feedback.length ? "feedback" : "daily_review", kind: p.kind, title: p.title.slice(0, 200), proposal: p.proposal.slice(0, 2000), evidence: p.evidence?.slice(0, 1000) ?? null, targetKey: p.kind === "setup" ? (p.targetKey ?? null) : null, conversationId: [p.conv, ...((p.evidence ?? "").match(/[0-9a-f]{8}/g) ?? [])].map(x => x && ids.find(id => id.startsWith(String(x).trim()))).find(Boolean) ?? null } });
  }
  if (feedback.length) await prisma.agentFeedback.updateMany({ where: { id: { in: feedback.map(f => f.id) } }, data: { status: "in_review", reviewedAt: now } });
  return proposals.length;
}

const OPEN = ["pending", "queued", "question", "review", "publish"];

/**
 * Manual reports only, merged (15.10.2026, Yair: "אני רוצה לקבל בסך הכל תקלות
 * שאנשים מדווחים עליהם בצורה ידנית, ואם הן דומות לתקלות שקיימות כבר, אז הן גם
 * מתאחדות"). Each new owner note about the agent becomes a proposal, or joins
 * an open one that is the same problem (from any shop: most are the base's).
 * One small model call per report. The conversation scan (reviewBusiness)
 * no longer runs by itself.
 */
type Decision = { same?: string; new?: Proposal } | null;

/** File one report: into the open problem the model named, else a new proposal (in the owner's own words when the model gave nothing). */
export async function fileReport(n: { id: string; businessId: string; text: string; conversationId: string | null }, report: Report, out: Decision, open: { id: string; title: string; reports: string | null }[], now = new Date()): Promise<"merged" | "created"> {
  const into = out?.same ? open.find(o => o.id.startsWith(String(out.same).trim())) : undefined;
  if (into) {
    await prisma.agentImprovement.update({ where: { id: into.id }, data: { reports: JSON.stringify([...parseReports(into.reports), report]) } });
    await prisma.agentFeedback.update({ where: { id: n.id }, data: { status: "in_review", reviewedAt: now, reviewNote: `התאחד עם: ${into.title}` } });
    return "merged";
  }
  const p = out?.new && ["rule", "faq", "setup", "base"].includes(out.new.kind) && out.new.title ? out.new : { kind: "base" as const, title: n.text.split("\n")[0].slice(0, 80), proposal: n.text, evidence: undefined };
  const row = await prisma.agentImprovement.create({ data: { businessId: n.businessId, source: "feedback", kind: p.kind, title: p.title.slice(0, 200), proposal: (p.proposal || n.text).slice(0, 2000), evidence: (p.evidence || report.evidence)?.slice(0, 1000) ?? null, conversationId: n.conversationId, reports: JSON.stringify([report]) } });
  await prisma.agentFeedback.update({ where: { id: n.id }, data: { status: "in_review", reviewedAt: now, reviewNote: `הצעה חדשה: ${row.title}` } });
  return "created";
}

export async function reviewReports(now = new Date(), opts: { notify?: boolean; ids?: string[] } = {}): Promise<{ reports: number; merged: number; created: number }> {
  // ids: a report sent from a chat is sorted right away (25.10.2026), not the next morning.
  const notes = await prisma.agentFeedback.findMany({ where: { status: "new", ...(opts.ids ? { id: { in: opts.ids } } : {}) }, orderBy: { createdAt: "asc" }, take: 30 });
  if (!notes.length) return { reports: 0, merged: 0, created: 0 };
  const names = new Map((await prisma.business.findMany({ where: { id: { in: Array.from(new Set(notes.map(n => n.businessId))) } }, select: { id: true, name: true } })).map(b => [b.id, b.name]));
  let merged = 0, created = 0;
  for (const n of notes) {
    const open = await prisma.agentImprovement.findMany({ where: { status: { in: OPEN } }, orderBy: { createdAt: "desc" }, take: 60, select: { id: true, title: true, proposal: true, reports: true } });
    let transcript = "";
    if (n.conversationId) {
      const msgs = await prisma.conversationMessage.findMany({ where: { conversationId: n.conversationId, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "desc" }, take: MAX_MSGS, select: { role: true, content: true, source: true } });
      transcript = msgs.reverse().map(m => `${m.role === "user" ? "לקוח" : m.source === "admin" ? "בעל העסק" : "סוכן"}: ${m.content.replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
    }
    // A report from inside a chat names the agent messages it is about (comma separated ids).
    const ids = (n.messageId ?? "").split(",").filter(Boolean);
    const reported = ids.length ? await prisma.conversationMessage.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: "asc" }, select: { content: true } }) : [];
    const quote = reported.length ? reported.map(m => m.content.replace(/\s+/g, " ").slice(0, 300)).join(" | ").slice(0, 900) : null;
    const report: Report = { at: n.createdAt.toISOString(), source: "feedback", businessId: n.businessId, businessName: names.get(n.businessId) ?? "", author: n.author, text: n.text, evidence: quote, conversationId: n.conversationId, feedbackId: n.id, messageId: n.messageId };
    const system = `אתה ממיין דיווח ידני על הסוכן שעונה בוואטסאפ ללקוחות של מספרה. אם הוא אותה בעיה כמו אחת הפתוחות ברשימה (גם אם ממספרה אחרת ובמילים אחרות), החזר את המזהה שלה. אחרת, נסח הצעה חדשה.
סוגים: "base" בעיה בהתנהגות הסוכן שחלה על כל העסקים, "rule" כלל של העסק הזה, "faq" שאלה ותשובה של העסק ("ש: ... ת: ..."), "setup" תשובה לשאלת הגדרה.
כתוב בעברית פשוטה, בלי מקפים ארוכים. החזר JSON בלבד: {"same":"<8 התווים של המזהה>"} או {"new":{"kind":"...","title":"קצר בעברית","proposal":"מה לתקן","evidence":"ציטוט קצר"}}`;
    const user = [
      open.length ? `בעיות פתוחות:\n${open.map(o => `- ${o.id.slice(0, 8)}: ${o.title}: ${o.proposal.replace(/\s+/g, " ").slice(0, 200)}`).join("\n")}` : "אין בעיות פתוחות.",
      `הדיווח (${report.businessName}${n.author ? `, ${n.author}` : ""}):\n${n.text}`,
      quote ? `התשובות של הסוכן שעליהן הדיווח:\n${quote}` : "",
      transcript ? `השיחה שעליה הדיווח:\n${transcript}` : "",
    ].filter(Boolean).join("\n\n");
    let out: Decision = null;
    try {
      const res = await anthropicFor("prod").messages.create({ model: MODEL, max_tokens: 600, system, messages: [{ role: "user", content: user.slice(0, 30000) }] });
      void recordAgentUsage({ businessId: n.businessId, provider: "anthropic", model: MODEL, kind: "review", usage: res.usage });
      const text = res.content.filter(b => b.type === "text").map(b => (b as { text: string }).text).join("");
      out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch (e) { console.error("[reports]", n.id, e); }
    if ((await fileReport(n, report, out, open, now)) === "merged") merged++; else created++;
  }
  if (opts.notify !== false && merged + created) {
    await recordCrmNotification(`דיווחים חדשים על הסוכן: ${merged + created}${merged ? ` (${merged} התאחדו עם בעיות קיימות)` : ""}`, { kind: "customer", href: "/admin/crm/improvements", push: true });
  }
  return { reports: notes.length, merged, created };
}

/** The daily run: manual reports only (15.10.2026). Kept under its old name for the cron and the CRM button. */
export async function runDailyReview(now = new Date()): Promise<{ reports: number; merged: number; created: number }> {
  return reviewReports(now);
}
