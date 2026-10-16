/**
 * The owner writes what he wants in his own words (16.10.2026, Yair: "אופציה
 * לכתוב בצורה חופשית, ואולי מודל llm יעבור על זה כדי להכניס לסיסטם פרומט ...
 * ואז נוכל להכניס הרבה שאלות פתוחות").
 *
 * One model call maps the text onto what already exists, never a new block:
 *   - a setup question it answers → that answer is replaced;
 *   - a fact customers ask about → a question + answer (same question replaced);
 *   - anything else about the agent → the shop's rules, merged with the ones
 *     already there (deduped, shortened, capped), never appended line by line.
 * Nothing is saved until the owner has seen "ככה הסוכן יבין" and pressed save.
 */
import { prisma } from "@/lib/prisma";
import { anthropicFor } from "@/lib/anthropic-clients";
import { recordAgentUsage } from "@/lib/agent/usage";
import { setupFieldsFor, PLATFORM_ONLY_SETUP_KEYS, type SetupConfig } from "@/lib/agent/setup-fields";
import { saveSetupAnswers } from "@/lib/agent/setup-save";

const MODEL = "claude-sonnet-4-6";
const RULES_MAX = 1200;

export type FreeTextPlan = {
  setup: Record<string, string | boolean>;
  rules: string | null;                 // the shop's whole rules text after the merge, or null = unchanged
  faqs: { question: string; answer: string; replaceQuestion?: string }[];
  understood: string[];                 // short Hebrew lines: what the agent will do
  notUsed: string[];                    // what was not turned into anything, and why
};

const parse = (raw: string | null | undefined): SetupConfig => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };

async function context(businessId: string) {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, businessType: true } });
  const cfg = await prisma.agentConfig.findUnique({ where: { businessId }, select: { setupConfig: true, faqs: { select: { question: true, answer: true } } } });
  const fields = setupFieldsFor(biz?.businessType).filter(f => !PLATFORM_ONLY_SETUP_KEYS.has(f.key) && f.key !== "businessRules");
  return { biz, setup: parse(cfg?.setupConfig), faqs: cfg?.faqs ?? [], fields };
}

/** Keep only what fits: known keys, allowed options, real booleans, bounded text. */
function clean(raw: Partial<FreeTextPlan>, fields: ReturnType<typeof setupFieldsFor>): FreeTextPlan {
  const setup: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(raw.setup ?? {})) {
    const f = fields.find(x => x.key === k);
    if (!f) continue;
    if (f.type === "bool") { if (typeof v === "boolean") setup[k] = v; continue; }
    if (typeof v !== "string" || !v.trim()) continue;
    if (f.type === "choice" && f.options && !f.options.includes(v.trim())) continue;
    setup[k] = v.trim().slice(0, 600);
  }
  const rules = typeof raw.rules === "string" ? raw.rules.split(/\n+/).map(l => l.trim().replace(/^[-•]\s*/, "")).filter(Boolean).join("\n").slice(0, RULES_MAX) : null;
  const faqs = (raw.faqs ?? []).filter(q => q && typeof q.question === "string" && typeof q.answer === "string" && q.question.trim() && q.answer.trim()).slice(0, 8)
    .map(q => ({ question: q.question.trim().slice(0, 200), answer: q.answer.trim().slice(0, 600), ...(q.replaceQuestion ? { replaceQuestion: String(q.replaceQuestion).slice(0, 200) } : {}) }));
  const lines = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && !!s.trim()).map(s => s.trim().slice(0, 200)).slice(0, 12) : []);
  return { setup, rules, faqs, understood: lines(raw.understood), notUsed: lines(raw.notUsed) };
}

/** The model's instructions and input (exported so they can be tried without the API). */
export async function freeTextPrompt(businessId: string, text: string) {
  const { biz, setup, faqs, fields } = await context(businessId);
  const fieldList = fields.map(f => `- ${f.key} (${f.label}): ${f.question}${f.type === "choice" && f.options ? ` אפשרויות: ${f.options.join(" / ")}` : f.type === "bool" ? " (true/false)" : ""}${setup[f.key] !== undefined && setup[f.key] !== "" ? ` | עכשיו: ${String(setup[f.key])}` : ""}`).join("\n");
  const system = `אתה מתרגם את מה שבעל העסק "${biz?.name ?? ""}" כתב על סוכן הוואטסאפ שלו להגדרות שכבר קיימות. אל תמציא דבר שלא כתב.
לכל דבר שכתב, בחר מקום אחד:
1. שאלת הגדרה מהרשימה שהוא עונה עליה → setup[key] = הערך (בבחירה: בדיוק אחת מהאפשרויות; כן/לא: true או false).
2. עובדה שלקוחות שואלים עליה (חניה, תשלום, משהו שהעסק עושה או לא) → faqs: שאלה ותשובה קצרה. אם יש כבר שאלה דומה ברשימה, replaceQuestion = השאלה הקיימת.
3. כל דבר אחר על איך הסוכן מתנהג → כללי העסק. החזר ב-rules את כל רשימת הכללים אחרי המיזוג: הקיימים והחדשים יחד, בלי כפילויות, כל כלל שורה קצרה, עד 12 שורות ועד ${RULES_MAX} תווים. כלל חדש שסותר כלל קיים מחליף אותו. אין כללים חדשים → rules = null.
מה שלא קשור לסוכן או לא ברור → notUsed, עם סיבה קצרה.
understood: שורות קצרות בעברית פשוטה, בגובה העיניים, מה הסוכן יעשה מעכשיו (לא שמות של מפתחות).
בלי מקפים ארוכים. החזר JSON בלבד: {"setup":{},"rules":null,"faqs":[],"understood":[],"notUsed":[]}`;
  const user = [
    `שאלות ההגדרה:\n${fieldList}`,
    `כללי העסק עכשיו:\n${String(setup.businessRules ?? "").trim() || "(אין)"}`,
    `שאלות ותשובות עכשיו:\n${faqs.map(q => `ש: ${q.question} ת: ${q.answer}`).join("\n") || "(אין)"}`,
    `מה שבעל העסק כתב:\n${text.slice(0, 4000)}`,
  ].join("\n\n");
  return { system, user, fields };
}

export async function planFreeText(businessId: string, text: string): Promise<FreeTextPlan> {
  const { system, user, fields } = await freeTextPrompt(businessId, text);
  const res = await anthropicFor("prod").messages.create({ model: MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: user }] });
  // Setting up his own agent is not his customers' traffic: tagged like the review runs.
  void recordAgentUsage({ businessId, provider: "anthropic", model: MODEL, kind: "review", usage: res.usage });
  const out = res.content.filter(b => b.type === "text").map(b => (b as { text: string }).text).join("");
  let raw: Partial<FreeTextPlan> = {};
  try { raw = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)); } catch { raw = {}; }
  return cleanPlan(raw, fields);
}

export const cleanPlan = clean;

/** Save a plan the owner approved (validated again: it came back from the browser). */
export async function applyFreeText(businessId: string, plan: Partial<FreeTextPlan>, author: "owner" | "wizard" = "owner"): Promise<FreeTextPlan> {
  const { fields } = await context(businessId);
  const p = clean(plan, fields);
  const patch: Record<string, unknown> = { ...p.setup };
  if (p.rules !== null) patch.businessRules = p.rules;
  if (Object.keys(patch).length) await saveSetupAnswers(businessId, patch, author);
  if (p.faqs.length) {
    const cfg = await prisma.agentConfig.findUnique({ where: { businessId }, select: { id: true } });
    if (cfg) for (const q of p.faqs) {
      const old = await prisma.agentFAQ.findFirst({ where: { agentConfigId: cfg.id, question: q.replaceQuestion ?? q.question } });
      if (old) await prisma.agentFAQ.update({ where: { id: old.id }, data: { question: q.question, answer: q.answer } });
      else await prisma.agentFAQ.create({ data: { agentConfigId: cfg.id, question: q.question, answer: q.answer } });
    }
  }
  return p;
}
