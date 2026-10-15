/**
 * A draft reply to a shop's requests (15.10.2026, Yair: "שאוכל לענות בחזרה משם
 * כדי לתת שירות, בטח יהיה הרבה בקשות שאולי קיימות"). Many requests are for
 * things the system already does: the draft says so and where (the same guide
 * and learned rules Chator's support agent uses). Yair edits it and sends it
 * himself from the CRM; nothing goes out from here.
 */
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { anthropicFor } from "@/lib/anthropic-clients";
import { MODEL_SMART } from "@/lib/agent/customer-agent";
import { recordAgentUsage } from "@/lib/agent/usage";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { SUPPORT_KNOWLEDGE, tidy } from "@/lib/agent/chator-support";
import { getCrmText } from "@/lib/crm/core";

export async function draftRequestReply(businessId: string): Promise<{ ok: true; draft: string } | { ok: false; error: string }> {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, settings: true } });
  if (!biz) return { ok: false, error: "העסק לא נמצא" };
  // What he asked since our last answer; nothing new → whatever is still open.
  const lastReply = await prisma.shopRequest.findFirst({ where: { businessId, fromChator: true }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  let asks = await prisma.shopRequest.findMany({ where: { businessId, fromChator: false, ...(lastReply ? { createdAt: { gt: lastReply.createdAt } } : {}) }, orderBy: { createdAt: "asc" }, take: 20 });
  if (!asks.length) asks = await prisma.shopRequest.findMany({ where: { businessId, fromChator: false, doneAt: null }, orderBy: { createdAt: "asc" }, take: 20 });
  const written = asks.filter(a => a.body?.trim());
  if (!written.length) return { ok: false, error: asks.length ? "יש כאן רק הקלטות. שמע אותן וכתוב תשובה" : "אין בקשה פתוחה לענות עליה" };

  const [knowledgeRow, rulesRow] = await Promise.all([getCrmText("supportKnowledge"), getCrmText("supportRules")]);
  const knowledge = knowledgeRow.text.trim() || SUPPORT_KNOWLEDGE;
  const rules = rulesRow.text.trim();
  const voices = asks.length - written.length;
  const list = written.map(a => `- ${a.authorName ?? "העסק"}: ${a.body!.trim()}`).join("\n");

  const system = `אתה יאיר מצ'אטור. בעל מספרה (${biz.name}) כתב לך במערכת בקשה: מה חסר לו או מה לשנות. כתוב טיוטת תשובה אחת, בשבילו, שיאיר יערוך וישלח.
המטרה: שירות. לכל בקשה:
- כבר קיים במערכת לפי המדריך: תגיד שזה כבר קיים, איפה בדיוק, ובמשפט אחד איך עושים. את הכתובת מהמדריך כתוב תמיד אחרי נקודתיים ורווח, למשל: "זה במסך המסלול: /admin/settings/plan".
- לא קיים: תודה, רשמנו, ונעדכן כשזה ייכנס. בלי תאריך ובלי להבטיח שזה ייבנה.
- לא ברור מה הוא מבקש: שאלה אחת קצרה שמבררת.
${voices ? `יש גם ${voices} הקלטות בלי טקסט: אל תנחש מה נאמר בהן ואל תתייחס אליהן.\n` : ""}עברית מדוברת, בגובה העיניים, קצר. בלי מקף ארוך, בלי כותרות ובלי הדגשות. רק מה שכתוב במדריך קיים; אם אתה לא בטוח שמשהו קיים, תתייחס אליו כלא קיים. החזר רק את התשובה.

${knowledge}${rules ? `\n\nכללים ותשובות שיאיר כבר נתן:\n${rules}` : ""}`;

  try {
    const res = await anthropicFor("prod").messages.create({ model: MODEL_SMART, max_tokens: 700, system, messages: [{ role: "user", content: `הבקשות:\n${list}` }] });
    void recordAgentUsage({ businessId: DEMO_BUSINESS_ID, provider: "anthropic", model: MODEL_SMART, kind: "sales", usage: res.usage });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("\n").trim();
    // A path glued to a Hebrew letter ("ל/admin/…") would not become a link.
    return text ? { ok: true, draft: tidy(text.replace(/([\u05D0-\u05EA])\/admin\//g, "$1: /admin/")) } : { ok: false, error: "לא התקבלה טיוטה, נסה שוב" };
  } catch {
    return { ok: false, error: "לא הצלחתי לנסח, נסה שוב" };
  }
}
