/**
 * A shop's reports on the agent, for its CRM customer card (26.10.2026, Yair:
 * "בכרטיס לקוח שלו יופיע כמו איזשהו בועה אדומה עם כמות הדיווחים ... והיסטוריה
 * דיווחים"). Each report (agent_feedback) is followed into the problem it was
 * filed under (agent_improvements.reports[].feedbackId), so its stage is the
 * problem's: חדש → אצל סוכן התיקונים → מחכה לאישור → תוקן, or נסגר.
 * Also composes a report from marked chat messages, for Chator's own chats
 * in the CRM (Yair's internal reports, same shape as the shops').
 */
import { prisma } from "@/lib/prisma";
import { parseReports } from "@/lib/agent/fix-queue";
import { REPORT_REASONS } from "@/lib/agent/report-reasons";

export type ReportStage = "new" | "agent" | "approve" | "done" | "closed";
export type ShopReport = { id: string; at: string; author: string | null; text: string; conversationId: string | null; stage: ReportStage; improvementId: string | null; title: string | null };
export const OPEN_STAGES = new Set<ReportStage>(["new", "agent", "approve"]);

const STAGE_OF: Record<string, ReportStage> = { pending: "new", queued: "agent", publish: "agent", revert: "agent", review: "approve", question: "approve", applied: "done", approved: "done", rejected: "closed", merged: "closed" };

export async function shopReports(businessIds: string[]): Promise<Map<string, ShopReport[]>> {
  const out = new Map<string, ShopReport[]>();
  if (!businessIds.length) return out;
  const [rows, imps] = await Promise.all([
    prisma.agentFeedback.findMany({ where: { businessId: { in: businessIds } }, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.agentImprovement.findMany({ where: { reports: { not: null } }, orderBy: { createdAt: "desc" }, take: 600, select: { id: true, status: true, title: true, reports: true } }),
  ]);
  const byFeedback = new Map<string, { id: string; status: string; title: string }>();
  for (const imp of imps) for (const r of parseReports(imp.reports)) if (r.feedbackId && !byFeedback.has(r.feedbackId)) byFeedback.set(r.feedbackId, imp);
  for (const f of rows) {
    const imp = byFeedback.get(f.id);
    const stage: ReportStage = imp ? STAGE_OF[imp.status] ?? "closed" : f.status === "applied" ? "done" : f.status === "dismissed" ? "closed" : "new";
    const list = out.get(f.businessId) ?? [];
    list.push({ id: f.id, at: f.createdAt.toISOString(), author: f.author, text: f.text, conversationId: f.conversationId, stage, improvementId: imp?.id ?? null, title: imp?.title ?? null });
    out.set(f.businessId, list);
  }
  return out;
}

/** The marked agent messages of one chat, each with why, in the chat's order (the same text the shops' reports have). */
export async function composeReport(conversationId: string, rawItems: unknown, rawReasons: unknown, rawText: unknown): Promise<{ text: string; messageId: string | null }> {
  const pick = (x: unknown): string[] => (Array.isArray(x) ? x.filter((r: unknown): r is string => typeof r === "string" && (REPORT_REASONS as readonly string[]).includes(r)) : []);
  const words = (x: unknown) => (typeof x === "string" ? x.trim().slice(0, 1000) : "");
  const items = (Array.isArray(rawItems) ? rawItems : []).slice(0, 20) as { messageId?: unknown; reasons?: unknown; text?: unknown }[];
  const ids = items.map(i => (typeof i.messageId === "string" ? i.messageId : "")).filter(Boolean);
  const msgs = ids.length ? await prisma.conversationMessage.findMany({ where: { id: { in: ids }, conversationId, role: "assistant" }, orderBy: { createdAt: "asc" }, select: { id: true, content: true } }) : [];
  const lines: string[] = [];
  for (const m of msgs) {
    const it = items.find(i => i.messageId === m.id)!;
    const why = [pick(it.reasons).join(", "), words(it.text)].filter(Boolean).join(". ");
    lines.push(`על התשובה «${m.content.replace(/\s+/g, " ").slice(0, 160)}»: ${why || "לא אהבתי"}`);
  }
  const general = [pick(rawReasons).join(", "), words(rawText)].filter(Boolean).join(": ");
  if (general) lines.push(lines.length ? `ובכללי: ${general}` : general);
  return { text: lines.join("\n").slice(0, 3000), messageId: msgs.map(m => m.id).join(",") || null };
}
