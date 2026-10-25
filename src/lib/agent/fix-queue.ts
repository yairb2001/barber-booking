/**
 * The fix agent's queue (15.10.2026, Yair: "כל הצעה מלבד להחליף מילה או 2 צריכה
 * לעבור אצל סוכן ai פה במחשב שמבין שאסור לנפח פרומטים ... שם אני אאשר דחיפה
 * סופית"). Flow and rules: docs/fix-agent.md.
 *
 *   pending  → Yair writes in his own words, "לסוכן התיקונים" → queued
 *   queued   → the morning run on his Mac prepares a fix → review (or question)
 *   review   → Yair sees it in the CRM: "אשר והעלה" → applied (data) / publish (code)
 *              or "תקן" with a note → queued again
 *   publish  → the next morning run pushes the code → applied
 *   applied  → "החזר אחורה" for 7 days → restored (data) / revert (code, next run)
 *
 * The prompt must not grow (Yair: "אסור שיגדל הרבה ... חייב אישור שלי והסבר
 * למה"): a fix that adds more than GROWTH_LIMIT characters to a prompt needs his
 * explicit OK next to the agent's reason.
 */
import { prisma } from "@/lib/prisma";
import { saveSetupAnswers } from "@/lib/agent/setup-save";
import { getCrmText, setCrmText } from "@/lib/crm/core";

export const GROWTH_LIMIT = 100;
/** A shop's whole system prompt never goes past this (25.10.2026, Yair: "הגבלה של לא
 *  לעבור X תווים"). Measured that day: a plain shop 12,710, DOMINANT 14,631. Not
 *  even with his tick: a fix that crosses it must shorten something else first. */
export const PROMPT_MAX = 15_000;
/** The shop's own rules text (same cap as "במילים שלך", free-text.ts RULES_MAX). */
export const RULES_MAX = 1_200;

export type FixPlan =
  | { type: "setup"; businessId: string; key: string; value: string | boolean }
  | { type: "rules"; businessId: string; text: string } // the shop's whole rules text, merged
  | { type: "faq"; businessId: string; question: string; answer: string; replaceQuestion?: string }
  | { type: "support_rules"; text: string } // Chator's support agent, whole text, merged
  | { type: "code"; branch: string; files: string[]; commit?: string }
  | { type: "none" };

export type Fix = {
  summary: string;           // one sentence, Hebrew: what changed
  appliesTo: string;         // "כל העסקים" / "רק DOMINANT"
  before?: string;           // the reply before the fix
  after?: string;            // the reply after it (from the replay)
  tested?: string;           // what was run to check it
  promptBefore?: number;     // characters
  promptAfter?: number;
  growthReason?: string;     // why it must grow, when it does
  question?: string;         // the agent needs Yair before it can fix
  plan: FixPlan;
  previous?: unknown;        // what a data fix replaced, for "החזר אחורה"
  history?: { at: string; who: string; text: string }[];  // "יאיר", "סוכן", or a CRM member's name
};

/** One manual report behind a proposal (15.10.2026: only manual reports, merged). */
export type Report = { at: string; source: string; businessId: string; businessName: string; author?: string | null; text: string; evidence?: string | null; conversationId?: string | null; feedbackId?: string | null; messageId?: string | null };
export const parseReports = (raw: string | null | undefined): Report[] => { try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch { return []; } };

export const parseFix = (raw: string | null | undefined): Fix | null => { try { return raw ? JSON.parse(raw) as Fix : null; } catch { return null; } };
export const growthOf = (f: Fix | null) => (f?.promptBefore != null && f?.promptAfter != null ? f.promptAfter - f.promptBefore : 0);
export const needsGrowthOk = (f: Fix | null) => growthOf(f) > GROWTH_LIMIT;

const parse = (raw: string | null | undefined): Record<string, unknown> => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };

/** Apply a data fix now. Returns what it replaced. Code fixes are pushed by the morning run. */
async function applyData(plan: FixPlan): Promise<unknown> {
  if (plan.type === "setup" || plan.type === "rules") {
    const cfg = await prisma.agentConfig.findUnique({ where: { businessId: plan.businessId }, select: { setupConfig: true } });
    const cur = parse(cfg?.setupConfig);
    const key = plan.type === "setup" ? plan.key : "businessRules";
    await saveSetupAnswers(plan.businessId, { [key]: plan.type === "setup" ? plan.value : plan.text }, "review");
    return { key, value: cur[key] ?? null };
  }
  if (plan.type === "faq") {
    const cfg = await prisma.agentConfig.findUnique({ where: { businessId: plan.businessId }, select: { id: true } });
    if (!cfg) throw new Error("לעסק אין סוכן");
    const old = await prisma.agentFAQ.findFirst({ where: { agentConfigId: cfg.id, question: plan.replaceQuestion ?? plan.question } });
    if (old) {
      await prisma.agentFAQ.update({ where: { id: old.id }, data: { question: plan.question, answer: plan.answer } });
      return { faqId: old.id, question: old.question, answer: old.answer };
    }
    const row = await prisma.agentFAQ.create({ data: { agentConfigId: cfg.id, question: plan.question, answer: plan.answer } });
    return { faqId: row.id, created: true };
  }
  if (plan.type === "support_rules") {
    const cur = (await getCrmText("supportRules")).text;
    await setCrmText("supportRules", plan.text);
    return { text: cur };
  }
  return null;
}

/** Undo a data fix with what it replaced. */
async function restoreData(plan: FixPlan, previous: unknown): Promise<void> {
  const p = (previous ?? {}) as Record<string, unknown>;
  if (plan.type === "setup" || plan.type === "rules") await saveSetupAnswers(plan.businessId, { [String(p.key)]: (p.value ?? "") as string }, "review");
  else if (plan.type === "faq" && typeof p.faqId === "string") {
    if (p.created) await prisma.agentFAQ.delete({ where: { id: p.faqId } }).catch(() => {});
    else await prisma.agentFAQ.update({ where: { id: p.faqId }, data: { question: String(p.question), answer: String(p.answer) } });
  } else if (plan.type === "support_rules") await setCrmText("supportRules", String(p.text ?? ""));
}

/**
 * A fix went live (25.10.2026): the shop reports behind it are closed, and every
 * shop that reported it hears it was fixed. Reporting only keeps happening when
 * people see that it helps.
 */
export async function closeReports(improvementId: string): Promise<void> {
  const imp = await prisma.agentImprovement.findUnique({ where: { id: improvementId }, select: { title: true, reports: true } });
  if (!imp) return;
  const reports = parseReports(imp.reports).filter(r => r.source === "feedback");
  const ids = reports.map(r => r.feedbackId).filter((x): x is string => !!x);
  if (ids.length) await prisma.agentFeedback.updateMany({ where: { id: { in: ids } }, data: { status: "applied", reviewedAt: new Date() } });
  const { centerNotify } = await import("@/lib/notify/center");
  for (const businessId of Array.from(new Set(reports.map(r => r.businessId)))) {
    await centerNotify({ businessId, kind: "account", title: "תיקנו את מה שדיווחת על הסוכן", body: imp.title, href: "/admin/chats" }).catch(() => {});
  }
}

const note = (f: Fix, who: string, text: string): Fix => ({ ...f, history: [...(f.history ?? []), { at: new Date().toISOString(), who, text }] });

/** Yair: "אשר והעלה". */
export async function publishFix(id: string, growthOk: boolean, who = "יאיר"): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const imp = await prisma.agentImprovement.findUnique({ where: { id } });
  const fix = parseFix(imp?.fix);
  if (!imp || imp.status !== "review" || !fix) return { ok: false, error: "אין כאן תיקון שמחכה לאישור" };
  if (needsGrowthOk(fix) && !growthOk) return { ok: false, error: "התיקון מגדיל את הפרומפט. צריך לסמן שאתה מאשר להגדיל" };
  if ((fix.promptAfter ?? 0) > PROMPT_MAX) return { ok: false, error: `התיקון מעביר את הפרומפט מעל ${PROMPT_MAX.toLocaleString("he-IL")} תווים. לחץ "תקן" ובקש לקצר` };
  if (fix.plan.type === "rules" && fix.plan.text.length > RULES_MAX) return { ok: false, error: `כללי העסק ארוכים מדי (מעל ${RULES_MAX.toLocaleString("he-IL")} תווים). לחץ "תקן" ובקש לקצר` };
  if (fix.plan.type === "code") {
    await prisma.agentImprovement.update({ where: { id }, data: { status: "publish", decidedAt: new Date(), decidedBy: who } });
    return { ok: true, status: "publish" };
  }
  const previous = await applyData(fix.plan);
  await prisma.agentImprovement.update({ where: { id }, data: { status: "applied", decidedAt: new Date(), decidedBy: who, fix: JSON.stringify(note({ ...fix, previous }, who, "אושר והועלה")) } });
  await closeReports(id);
  return { ok: true, status: "applied" };
}

/** Yair: "תקן" with his words, or an answer to the agent's question → back to the agent. */
export async function reviseFix(id: string, text: string, who = "יאיר"): Promise<boolean> {
  const imp = await prisma.agentImprovement.findUnique({ where: { id } });
  if (!imp || !["review", "question"].includes(imp.status) || !text.trim()) return false;
  const fix = parseFix(imp.fix) ?? { summary: "", appliesTo: "", plan: { type: "none" } as FixPlan };
  await prisma.agentImprovement.update({ where: { id }, data: { status: "queued", note: [imp.note, text.trim()].filter(Boolean).join("\n"), fix: JSON.stringify(note({ ...fix, question: undefined }, who, text.trim())) } });
  return true;
}

/** Yair: "החזר אחורה", up to 7 days after it went live. */
export async function revertFix(id: string, who = "יאיר"): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const imp = await prisma.agentImprovement.findUnique({ where: { id } });
  const fix = parseFix(imp?.fix);
  if (!imp || imp.status !== "applied" || !fix) return { ok: false, error: "אין מה להחזיר" };
  if (imp.decidedAt && Date.now() - imp.decidedAt.getTime() > 7 * 86400_000) return { ok: false, error: "עברו יותר מ-7 ימים" };
  if (fix.plan.type === "code") {
    await prisma.agentImprovement.update({ where: { id }, data: { status: "revert", fix: JSON.stringify(note(fix, who, "בקשה להחזיר אחורה")) } });
    return { ok: true, status: "revert" };
  }
  if (fix.plan.type === "none") return { ok: false, error: "אין מה להחזיר" };
  await restoreData(fix.plan, fix.previous);
  await prisma.agentImprovement.update({ where: { id }, data: { status: "rejected", fix: JSON.stringify(note(fix, who, "הוחזר אחורה")) } });
  return { ok: true, status: "rejected" };
}
