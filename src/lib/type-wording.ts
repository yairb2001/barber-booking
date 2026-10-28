import { vocabFor, type BusinessType, type Vocab } from "@/lib/vocab";
import type { MessageKind } from "@/lib/messaging/types";

/**
 * Our default WhatsApp texts were written for a men's barbershop (DOMINANT).
 * A women's salon, nail studio or cosmetics clinic gets the same texts in its
 * own words (16.10.2026, Yair: "שהמערכת תהיה תואמת למכוני יופי ומספרות נשים
 * וכל השאר"): its emoji instead of 💈, the customer addressed as a woman,
 * "טיפול" where a haircut makes no sense, and the staff member speaking as a
 * woman. Exact phrases of our defaults only, so a shop's own wording stays as
 * the shop wrote it. Pure (no server imports): the templates screen shows the
 * defaults through the same function, so what the shop sees is what is sent.
 */

/** A business's words: its type, or the vocabulary itself (with the owner's
 *  own words and genders from settings.vocab). */
type Words = Vocab | string | null | undefined;
const vocabOfWords = (x: Words): Vocab => (x && typeof x === "object" ? x : vocabFor(x));

/** Sentences of ours that only fit a barbershop, in a type's words. */
function haircutSentences(v: Vocab): [string, string][] {
  const f = v.customerFem, t = v.treatment;
  return [
    ["בביקור הזה תוכל לשדרג את התספורת עם טיפול זקן/עיצוב בהנחה", `בביקור הזה ${f ? "תוכלי" : "תוכל"} להוסיף ${t} משלים בהנחה`],
    ["תחויב/י במחיר המלא של התספורת", `${f ? "תחויבי" : "תחויב/י"} במחיר המלא של ה${t}`],
    ["לארח אותך ולגזור לך!", v.type === "other" ? "לארח אותך!" : "לארח ולפנק אותך!"],
    ["שהסתפרת אצלנו", "שביקרת אצלנו"],
  ];
}

/** The customer addressed as a woman. Order matters: whole sentences before
 *  the single words inside them. */
const FEM: [string, string][] = [
  ["מסכים? ענה *כן* או *לא*", "מסכימה? עני *כן* או *לא*"],
  ["ענה *כן* או *לא*", "עני *כן* או *לא*"],
  ["ענה כן או לא", "עני כן או לא"],
  ["ברוך הבא ל", "ברוכה הבאה ל"],
  ["פשוט כתוב לנו כאן", "פשוט כתבי לנו כאן"],
  ["תחויב/י", "תחויבי"],
  ["מקווים שתביני/תבין", "מקווים שתביני"],
  ["ללקוח אחר", "ללקוחה אחרת"],
  ["נראה שאתה צריך", "נראה שאת צריכה"],
  ["ואם אתה צריך", "ואם את צריכה"],
  ["מאחר, להזיז או לבטל", "מאחרת, להזיז או לבטל"],
  ["ואם תרצה", "ואם תרצי"],
  // Referral thank-you (api/appointments): the friend and the referrer.
  ["והזכיר את שמך כמי שהמליץ", "והזכירה את שמך כמי שהמליצה"],
  ["קבע תור ב*", "קבעה תור ב*"],
  ["דבר/י איתנו", "דברי איתנו"],
  [" חברים — מגיעה לך", " חברות — מגיעה לך"],
  ["עוד 1 חבר ו", "עוד 1 חברה ו"],
  [" חברים ו", " חברות ו"],
];

/** Second-person verbs as whole words (never inside a longer word). */
const FEM_WORDS: [string, string][] = [["תגיד", "תגידי"], ["תכתוב", "תכתבי"], ["תוכל", "תוכלי"], ["תרצה", "תרצי"]];

/** The staff member speaking (a closed day, in her own voice) — by that
 *  person's own gender (staffVoice), not the business's. */
const STAFF_FEM: [string, string][] = [
  ["אני נאלץ", "אני נאלצת"],
  ["אני יכול לקבוע", "אני יכולה לקבוע"],
  ["רק מוודא שראית", "רק מוודאת שראית"],
  ["זה שוב ", "זו שוב "],
  [", זה ", ", זו "],
];

/** The walk-in thank-you's "find us on WhatsApp with the words" line; a
 *  business of another kind has no such words, and the line goes. */
const KEYWORDS: Record<BusinessType, string | null> = {
  barber_men: "*מספרה* | *תספורת* | *ספר*",
  barber_women: "*מספרה* | *תספורת* | *ספרית*",
  nails: "*ציפורניים* | *לק ג'ל* | *מניקור*",
  cosmetics: "*קוסמטיקה* | *טיפול פנים* | *קוסמטיקאית*",
  other: null,
};
const KEYWORDS_LINE = "אפשר למצוא אותנו בוואצאפ עם המילים:\n";

/** ✂️ beside the business name: a salon keeps the scissors, the others don't cut. */
const SCISSORS: Record<BusinessType, string> = { barber_men: "✂️", barber_women: "✂️", nails: "💅", cosmetics: "✨", other: "✨" };

const HEB = "א-ת";
// No lookbehind: older iPhones (Safari before 16.4) cannot parse it.
const word = (w: string) => new RegExp(`(^|[^${HEB}])${w}(?![${HEB}])`, "g");

export function forType(text: string, words: Words): string {
  const v = vocabOfWords(words);
  if (!text) return text;
  let out = text;
  if (v.type !== "barber_men") {
    for (const [a, b] of haircutSentences(v)) out = out.split(a).join(b);
    const kw = KEYWORDS[v.type];
    out = kw ? out.split(KEYWORDS.barber_men!).join(kw) : out.split(KEYWORDS_LINE + KEYWORDS.barber_men! + "\n").join("").split(KEYWORDS_LINE + KEYWORDS.barber_men!).join("").replace(/\n{3,}/g, "\n\n");
    out = out.split("💈").join(v.emoji).split("✂️").join(SCISSORS[v.type]);
  }
  if (v.customerFem) {
    for (const [a, b] of FEM) out = out.split(a).join(b);
    for (const [a, b] of FEM_WORDS) out = out.replace(word(a), (_m, pre: string) => pre + b);
  }
  return out;
}

/** A message in a staff member's own voice ("אני נאלץ" → "אני נאלצת" for a woman, 16.10.2026). */
export function staffVoice(text: string, fem: boolean): string {
  if (!fem || !text) return text;
  let out = text;
  for (const [a, b] of STAFF_FEM) out = out.split(a).join(b);
  return out;
}

/** The system's own messages to customers, the ones forType() adapts. What a
 *  person or the agent wrote (manual, broadcast, agent replies) and what goes
 *  to the owner or the team is sent as written. */
const SYSTEM_KINDS = new Set<MessageKind>([
  "confirmation", "reminder_24h", "reminder_2h", "waitlist_notify", "first_booking", "walk_in",
  "swap_proposal", "swap_followup", "move_proposal", "cancel_proposal", "swap_confirmation", "swap_cancelled",
  "appointment_moved", "delay_notification", "appointment_cancelled", "appointment_no_show",
  "closure_notice", "closure_reminder", "referral_thankyou", "reengage", "post_first_visit", "post_every_visit",
  "rhythm_nudge", "rhythm_nudge_2", "rhythm_nudge_new",
  "call_new_missed", "call_new_answered", "call_known_missed_upcoming", "call_known_missed",
  "greeting_link", "link_nudge", "agent_unavailable",
  "class_booked", "class_waitlist", "class_promoted", "class_cancelled",
]);

export function adaptsKind(kind: MessageKind): boolean {
  return SYSTEM_KINDS.has(kind);
}

/** The agent's replies: its fixed lines written in code ("מאשר?", "נתראה 💈",
 *  "אם תרצה לקבוע מחדש") and any 💈 the model copied from a tool result.
 *  Narrow on purpose: the model writes its own Hebrew, and there "תוכל" may
 *  be "she will be able", about the staff member, not "you will". */
export function agentReplyForType(text: string, words: Words): string {
  const v = vocabOfWords(words);
  if (!text) return text;
  let out = v.type === "barber_men" ? text : text.split("💈").join(v.emoji);
  if (v.customerFem) {
    out = out
      .replace(/(^|\n)מאשר\?/g, (_m, pre: string) => pre + "מאשרת?")
      .split("אם תרצה לקבוע מחדש").join("אם תרצי לקבוע מחדש")
      .split(": אתה ב-").join(": את ב-");
  } else if (v.type === "other") {
    // A mixed place (a salon for men and women, 28.10.2026): the fixed question
    // in a form that fits both, never "מאשר/ת?"; and a gendered "ברוך הבא" at
    // the end of a greeting is dropped ("היי! ברוך הבא 😊" → "היי! 😊").
    out = out.replace(/(^|\n)מאשר\?/g, (_m, pre: string) => pre + "לאשר?")
      .replace(/[,\s]*(?:ברוך הבא|ברוכה הבאה)(?=[^א-תa-zA-Z0-9\n]*$)/gm, "");
  }
  // WhatsApp shows "**" as is (28.10.2026: "**שירן נייל:**" in a service list).
  // "יש המון מקום" makes a business sound empty (Yair, 28.10.2026: "לא אהבתי
  // שהוא אומר המון מקום"); "מלא" only after "יש", since "היום מלא" means full.
  return out.replace(/\*\*/g, "")
    .replace(/(יש (?:עוד )?)?(המון|הרבה|מלא) (מקום|שעות|אפשרויות|תורים)/g, (m, yesh: string | undefined, q: string, what: string) =>
      q === "מלא" && !yesh ? m : `${yesh ?? ""}כמה ${what === "מקום" ? "תורים פנויים" : what}`)
    .replace(/(יש (?:עוד )?)המון(?= עד|\s*[).,!]|$)/gm, "$1כמה");
}
