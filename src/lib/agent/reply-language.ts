/**
 * The customer writes Arabic or Russian only (27.11.2026): the code's fixed lines ("רגע לפני שאני קובע…",
 * "סגור, קבעתי לך") went out in Hebrew. A reply that still has Hebrew in it is translated before it is sent.
 */
import { anthropicFor } from "@/lib/anthropic-clients";
import { recordAgentUsage } from "@/lib/agent/usage";

const NAMES = { ar: "Arabic", ru: "Russian" } as const;

/** "ar" / "ru" when his message is in that script with no Hebrew in it (he mixes Hebrew → he reads it). */
export function foreignLang(text: string): keyof typeof NAMES | null {
  if (/[א-ת]/.test(text)) return null;
  if ((text.match(/[؀-ۿ]/g) ?? []).length >= 3) return "ar";
  if ((text.match(/[Ѐ-ӿ]/g) ?? []).length >= 3) return "ru";
  return null;
}

export async function inCustomerLanguage(reply: string, incoming: string, o: { businessId: string; conversationId: string; kind: string; sandbox: boolean; earlier?: string[] }): Promise<string> {
  // "да" or "ok" is too short to tell: his earlier messages say it (27.11.2026, a booking closed in Hebrew).
  const lang = foreignLang(incoming) ?? (/[א-ת]/.test(incoming) ? null : (o.earlier ?? []).map(foreignLang).find(Boolean) ?? null);
  if (!lang || !/[א-ת]{2,}/.test(reply)) return reply;
  try {
    const r = await anthropicFor(o.sandbox ? "test" : "prod").messages.create({
      model: "claude-haiku-4-5", max_tokens: 800,
      system: `Translate this WhatsApp message from a business to its customer into ${NAMES[lang]}. Keep every name, date, hour, price, link, emoji and line break exactly as they are. "מחרתיים" is the day after tomorrow, not tomorrow; "מחר" is tomorrow. Write only the translation.`,
      messages: [{ role: "user", content: reply }],
    });
    void recordAgentUsage({ businessId: o.businessId, provider: "anthropic", model: "claude-haiku-4-5", kind: o.kind, conversationId: o.conversationId, usage: r.usage });
    const out = r.content.map(b => (b.type === "text" ? b.text : "")).join("").trim();
    return out || reply;
  } catch (e) {
    console.error("[agent] translate failed", e);
    return reply;
  }
}
