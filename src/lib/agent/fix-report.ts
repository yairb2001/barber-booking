/**
 * "What exactly changes" in a fix, for the fix report in the CRM (26.10.2026,
 * Yair: "אני רוצה לראות מה הוא משנה, שיהיה לי אופציה לפתוח את הדוח תיקון").
 * Data fixes: the text before and after (before = what is there now, or what
 * the fix replaced once it went live). Code fixes: the files and a link to
 * the change on GitHub.
 */
import { prisma } from "@/lib/prisma";
import { setupFieldsFor } from "@/lib/agent/setup-fields";
import { getCrmText } from "@/lib/crm/core";
import type { Fix } from "@/lib/agent/fix-queue";

export type FixChange = { what: string; before?: string | null; after?: string | null; files?: string[]; url?: string | null };
const REPO = "https://github.com/yairb2001/barber-booking";
const parse = (raw: string | null | undefined): Record<string, unknown> => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };
const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : typeof v === "boolean" ? (v ? "כן" : "לא") : String(v));

export async function describeChange(fix: Fix | null, live: boolean): Promise<FixChange | null> {
  if (!fix) return null;
  const plan = fix.plan;
  const prev = (fix.previous ?? null) as Record<string, unknown> | null;
  if (plan.type === "setup" || plan.type === "rules") {
    const [cfg, biz] = await Promise.all([
      prisma.agentConfig.findUnique({ where: { businessId: plan.businessId }, select: { setupConfig: true } }),
      prisma.business.findUnique({ where: { id: plan.businessId }, select: { businessType: true } }),
    ]);
    const key = plan.type === "setup" ? plan.key : "businessRules";
    const label = plan.type === "rules" ? "כללי העסק" : setupFieldsFor(biz?.businessType).find(f => f.key === key)?.label ?? key;
    const before = live ? str(prev?.value) : str(parse(cfg?.setupConfig)[key]);
    return { what: plan.type === "rules" ? "כללי העסק, כל הטקסט אחרי המיזוג" : `התשובה לשאלה: ${label}`, before, after: plan.type === "setup" ? str(plan.value) : plan.text };
  }
  if (plan.type === "faq") {
    let before: string | null = null;
    if (live) before = prev && typeof prev.question === "string" ? `ש: ${prev.question}\nת: ${String(prev.answer ?? "")}` : null;
    else {
      const cfg = await prisma.agentConfig.findUnique({ where: { businessId: plan.businessId }, select: { id: true } });
      const old = cfg ? await prisma.agentFAQ.findFirst({ where: { agentConfigId: cfg.id, question: plan.replaceQuestion ?? plan.question }, select: { question: true, answer: true } }) : null;
      before = old ? `ש: ${old.question}\nת: ${old.answer}` : null;
    }
    return { what: before ? "שאלה ותשובה, מחליפה את הקיימת" : "שאלה ותשובה חדשה", before, after: `ש: ${plan.question}\nת: ${plan.answer}` };
  }
  if (plan.type === "support_rules") {
    const before = live ? str(prev?.text) : (await getCrmText("supportRules")).text || null;
    return { what: "הכללים של הסוכן של צ'אטור, כל הטקסט", before, after: plan.text };
  }
  if (plan.type === "code") {
    const url = plan.commit ? `${REPO}/commit/${plan.commit}` : plan.branch ? `${REPO}/compare/main...${encodeURIComponent(plan.branch)}` : null;
    return { what: "שינוי בקוד של הסוכן", files: plan.files, url };
  }
  return { what: "אין שינוי" };
}
