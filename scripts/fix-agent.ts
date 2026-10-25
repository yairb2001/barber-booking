/**
 * The fix agent's hands (15.10.2026). The morning run (a scheduled Claude Code
 * session on Yair's Mac, rules in docs/fix-agent.md) reads and writes the CRM's
 * improvements queue through this script only.
 *
 *   npx tsx --env-file=.env scripts/fix-agent.ts queue                 work to do, as JSON (with the conversations)
 *   npx tsx --env-file=.env scripts/fix-agent.ts prompt-size <bizId>   the shop agent's fixed prompt, in characters
 *   npx tsx --env-file=.env scripts/fix-agent.ts prompt-size support   Chator's support agent (guide + rules)
 *   npx tsx --env-file=.env scripts/fix-agent.ts current <bizId>       the shop's setup answers, rules and FAQs now
 *   npx tsx --env-file=.env scripts/fix-agent.ts report <id> <fix.json> a prepared fix → "לאישור שלך" (or a question)
 *   npx tsx --env-file=.env scripts/fix-agent.ts applied <id> [commit] a code fix is live
 *   npx tsx --env-file=.env scripts/fix-agent.ts reverted <id>         a code fix was taken back
 *   npx tsx --env-file=.env scripts/fix-agent.ts notify                one push to Yair (and the reports members) when something waits
 */
import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { parseFix, parseReports, closeReports, type Fix } from "@/lib/agent/fix-queue";
import { stablePromptParams, buildCatalogBlock, buildSystemPrompt } from "@/lib/agent/customer-agent";
import { buildBookingLink } from "@/lib/link-first";
import { getCrmText } from "@/lib/crm/core";
import { SUPPORT_KNOWLEDGE } from "@/lib/agent/chator-support";
import { recordCrmNotification } from "@/lib/crm/notify";
import { pushReportsMembers } from "@/lib/crm/member-push";

const [cmd, a1, a2] = process.argv.slice(2);
const out = (v: unknown) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
const who = (role: string, source: string | null) => (role === "user" ? "לקוח" : source === "admin" ? "העסק" : "סוכן");

async function transcript(id: string): Promise<string> {
  const msgs = await prisma.conversationMessage.findMany({ where: { conversationId: id, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "asc" }, take: 120, select: { role: true, source: true, content: true, createdAt: true } });
  return msgs.map(m => `[${m.createdAt.toISOString().slice(0, 16)}] ${who(m.role, m.source)}: ${m.content}`).join("\n");
}

async function promptSize(target: string): Promise<number> {
  if (target === "support") {
    const knowledge = (await getCrmText("supportKnowledge")).text.trim() || SUPPORT_KNOWLEDGE;
    return knowledge.length + (await getCrmText("supportRules")).text.trim().length;
  }
  const [biz, agentConfig] = await Promise.all([
    prisma.business.findUnique({ where: { id: target }, select: { id: true, slug: true, name: true, settings: true, businessType: true } }),
    prisma.agentConfig.findUnique({ where: { businessId: target }, include: { faqs: { orderBy: { sortOrder: "asc" } } } }),
  ]);
  if (!biz) throw new Error("no such business");
  const [catalogBlock, bookingLink] = await Promise.all([buildCatalogBlock(target), buildBookingLink(biz)]);
  const blocks = buildSystemPrompt({ ...stablePromptParams(biz, agentConfig, catalogBlock, bookingLink), now: "" });
  return blocks.reduce((n, b) => n + b.text.length, 0);
}

async function main() {
  if (cmd === "queue") {
    const items = await prisma.agentImprovement.findMany({ where: { status: { in: ["queued", "publish", "revert"] } }, orderBy: { createdAt: "asc" } });
    const names = new Map((await prisma.business.findMany({ where: { id: { in: items.map(i => i.businessId) } }, select: { id: true, name: true } })).map(b => [b.id, b.name]));
    const work = [];
    for (const i of items) {
      // Every conversation it points at: the stored one and any "שיחה 5a90d6b3" in the evidence.
      const reports = parseReports(i.reports);
      const ids = new Set<string>([i.conversationId, ...reports.map(r => r.conversationId)].filter((x): x is string => !!x));
      for (const p of (i.evidence ?? "").match(/\b[0-9a-f]{8}\b/g) ?? []) {
        const c = await prisma.conversation.findFirst({ where: { businessId: i.businessId, id: { startsWith: p } }, select: { id: true } });
        if (c) ids.add(c.id);
      }
      work.push({
        id: i.id, status: i.status, businessId: i.businessId, businessName: names.get(i.businessId) ?? "", kind: i.kind, source: i.source,
        title: i.title, yairWords: i.proposal, yairNotes: i.note, evidence: i.evidence, reports, targetKey: i.targetKey, previousFix: parseFix(i.fix),
        conversations: await Promise.all(Array.from(ids).slice(0, 3).map(async id => ({ id, transcript: await transcript(id) }))),
      });
    }
    out(work);
  } else if (cmd === "prompt-size") {
    out(String(await promptSize(a1)));
  } else if (cmd === "current") {
    const cfg = await prisma.agentConfig.findUnique({ where: { businessId: a1 }, select: { setupConfig: true, systemPrompt: true, faqs: { select: { question: true, answer: true } } } });
    out({ setup: cfg?.setupConfig ? JSON.parse(cfg.setupConfig) : {}, customPrompt: !!cfg?.systemPrompt?.trim(), faqs: cfg?.faqs ?? [], supportRules: (await getCrmText("supportRules")).text });
  } else if (cmd === "report") {
    const imp = await prisma.agentImprovement.findUnique({ where: { id: a1 } });
    if (!imp || imp.status !== "queued") throw new Error(`not queued: ${a1}`);
    const fix = JSON.parse(fs.readFileSync(a2, "utf8")) as Fix;
    if (!fix.plan?.type) throw new Error("fix.plan.type is required");
    if (!fix.question && (!fix.summary || !fix.appliesTo)) throw new Error("summary and appliesTo are required");
    const prev = parseFix(imp.fix);
    const history = [...(prev?.history ?? []), { at: new Date().toISOString(), who: "סוכן" as const, text: fix.question ? `שאלה: ${fix.question}` : fix.summary }];
    await prisma.agentImprovement.update({ where: { id: a1 }, data: { status: fix.question ? "question" : "review", fix: JSON.stringify({ ...fix, history }), fixAt: new Date() } });
    out(fix.question ? "question" : "review");
  } else if (cmd === "applied" || cmd === "reverted") {
    const imp = await prisma.agentImprovement.findUnique({ where: { id: a1 } });
    const fix = parseFix(imp?.fix);
    if (!imp || !fix) throw new Error(`no fix: ${a1}`);
    const text = cmd === "applied" ? `עלה לאוויר${a2 ? ` (${a2})` : ""}` : "הוחזר אחורה";
    const plan = cmd === "applied" && a2 && fix.plan.type === "code" ? { ...fix.plan, commit: a2 } : fix.plan;
    await prisma.agentImprovement.update({ where: { id: a1 }, data: { status: cmd === "applied" ? "applied" : "rejected", ...(cmd === "applied" ? { decidedAt: new Date() } : {}), fix: JSON.stringify({ ...fix, plan, history: [...(fix.history ?? []), { at: new Date().toISOString(), who: "סוכן", text }] }) } });
    if (cmd === "applied") await closeReports(a1);
    out("ok");
  } else if (cmd === "notify") {
    const [review, question] = await Promise.all([prisma.agentImprovement.count({ where: { status: "review" } }), prisma.agentImprovement.count({ where: { status: "question" } })]);
    if (review + question) {
      const parts = [review ? `${review} ${review === 1 ? "תיקון מחכה" : "תיקונים מחכים"} לאישור שלך` : "", question ? `${question} ${question === 1 ? "שאלה" : "שאלות"} אליך` : ""].filter(Boolean);
      await recordCrmNotification(`סוכן התיקונים: ${parts.join(", ")}`, { kind: "customer", href: "/admin/crm/improvements", push: true });
      // The reports members (Nika) approve them too: one push to their own phones.
      await pushReportsMembers({ title: "סוכן התיקונים סיים", body: parts.join(", "), url: "/admin/crm/reports", tag: "reports-approve" });
    }
    out(String(review + question));
  } else {
    out("usage: queue | prompt-size <bizId|support> | current <bizId> | report <id> <fix.json> | applied <id> [commit] | reverted <id> | notify");
    process.exitCode = 1;
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
