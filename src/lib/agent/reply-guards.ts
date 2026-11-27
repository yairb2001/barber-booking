/**
 * Checks on the agent's reply before it is sent, in code (25.11.2026, the test
 * of 13 business types). Each one is a promise the model broke in a real chat.
 */

const PHONE = /(?:\+?972[-\s]?|(?<!\d)0)(?:[23489]|5\d|7\d)[-\s]?\d{3}[-\s]?\d{4}(?!\d)/g;
const digits = (s: string) => s.replace(/\D/g, "");

/** A phone number that appears nowhere in what the agent was given is invented
 *  ("גרר 04-6500600", a garage's agent made it up). It is taken out of the reply. */
export function dropInventedPhones(reply: string, known: string, wholeNumbers = true): string {
  // Each number on its own: all the digits joined (ids, dates) held almost any 9 digits (27.11.2026, a vet agent's "073-7026516").
  const ref = wholeNumbers ? Array.from(known.matchAll(/\d[\d\s-]{5,}\d/g), m => digits(m[0])).join("|") : digits(known);
  return reply.replace(PHONE, m => (ref.includes(digits(m).replace(/^(972|0)/, "")) ? m : ""))
    .replace(/[ \t]*\([ \t]*\)/g, "").replace(/[ \t]{2,}/g, " ");
}

const WAITLIST_ASK = /(רשימת ה?המתנה|אעדכן אותך|שארשום אותך|להירשם להמתנה)[^\n?]*\?/;
const WAITLIST_TALK = /המתנה|תעדכ|עדכן|יתפנה|תרשמ|תרשום|^\s*(כן|בטח|יאללה|סבבה|אשמח)/;
const dayWords = (s: string) => (s.match(/ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|מחר|היום|\d{1,2}[./]\d{1,2}/g) ?? []).sort().join(",");

/** The waitlist is offered once. "כרגע לא" or "זה בוט?" after the offer got the same
 *  question again (28.10.2026 and 25.11.2026): the repeat is dropped, the rest stays. */
export function dropRepeatedWaitlistAsk(reply: string, earlier: string[], incoming: string): string {
  const asked = reply.match(WAITLIST_ASK)?.[0];
  if (!asked || WAITLIST_TALK.test(incoming)) return reply;
  const before = earlier.map(t => t.match(WAITLIST_ASK)?.[0]).filter((x): x is string => !!x);
  // Another day is another offer.
  if (!before.some(b => !dayWords(asked) || !dayWords(b) || dayWords(b) === dayWords(asked))) return reply;
  const rest = reply.split(/(?<=[.!?\n])/).filter(s => !WAITLIST_ASK.test(s)).join("").trim();
  return rest || "סבבה, אני כאן אם צריך משהו.";
}

/** No waitlist for a weekday that person never works ("אם יתפנה אצל משה ביום ראשון", 25.11.2026). */
export function dropWaitlistForDayOff(reply: string, workDays: { name: string; days: string[] }[]): string {
  const asked = reply.match(WAITLIST_ASK)?.[0];
  const day = asked?.match(/ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת/)?.[0];
  const who = asked && day ? workDays.find(w => asked.includes(w.name)) : undefined;
  if (!who || who.days.includes(day!)) return reply;
  return reply.split(/(?<=[.!?\n])/).filter(x => !WAITLIST_ASK.test(x)).join("").trim() || "סבבה, אני כאן אם צריך משהו.";
}

/** "<br>" reached a customer as text (25.11.2026). */
export const withoutHtml = (reply: string): string => reply.replace(/[ \t]*<\/?[a-z][^<>\n]{0,40}>[ \t]*/gi, "").replace(/\n{3,}/g, "\n\n");

const PROMISED = /בודק|אבדוק|לבדוק|בדקתי|אחזור|חוזר|יחזרו|אברר|מברר|שאלתי|שלחתי|העברתי|מעביר|check|get back/i;

/** ask_owner ran, but the sentence that says so came before the tool call and was lost; and the question
 *  only went out, so "בדקתי" is not true yet. */
export function withAskOwnerPromise(reply: string, asked: boolean): string {
  if (!asked) return reply;
  const honest = reply.replace(/(^|[^א-ת])בדקתי (?:עם|מול) /g, "$1שאלתי את ").replace(/(^|[^א-ת])בדקתי(?![א-ת])/g, "$1שאלתי");
  return PROMISED.test(honest) ? honest : `אני בודק את זה וחוזר אליך.\n\n${honest}`;
}

/** "סגור ✅, מחר ב-10:00" / "קבעתי לך" / "התור נקבע": says an appointment exists (25.11.2026, said twice with nothing booked). */
export const claimsBooked = (reply: string): boolean => /(?:^|[\n.!] ?)\s*(?:סגור ?✅|קבעתי|מעולה, התור נקבע|התור נקבע)|\d{1,2}:\d{2}[^\n?]{0,40}(?:[-,] ?)קבוע[!.]/.test(reply) && !/[?؟]\s*$/.test(reply.trim());

/** A sentence about our own tools ("קרא לי propose_booking", 25.11.2026) is not for the customer. */
export const withoutToolNames = (reply: string): string =>
  reply.split(/(?<=[.!?\n])/).filter(x => !/[a-z]+_[a-z_]+/.test(x.replace(/https?:\S+/g, ""))).join("").replace(/\n{3,}/g, "\n\n").trim() || reply;

const ASKS_PRICE = /כמה (?:זה )?(?:עולה|יעלה|עולים|עלה)|מה המחיר|מחיר|עלות/;
const SAYS_PRICE = /₪|שקל|ש["״]ח|חינם|ללא עלות|בלי עלות/;
/** He asked the price and an hour in one message, and only the hour was answered (25.11.2026). */
export const missesPrice = (reply: string, incoming: string): boolean => ASKS_PRICE.test(incoming) && !SAYS_PRICE.test(reply);

// "Go there now", not a mention ("מקווה שהכל בסדר בחדר המיון").
const GO = "(?:פנה|פני|פנו|לפנות|תפנה|גש|גשי|לגשת|לך|לכי|ללכת|להגיע|חייג|חייגי|לחייג|התקשר|התקשרי|להתקשר)";
const EMERGENCY = new RegExp(`${GO}[^\\n]{0,40}(?:חדרי? ה?מיון|מד["״]א|(?<!\\d)(?:101|1201)(?!\\d))|חדר ה?מיון (?:מיד|מייד|עכשיו)|ער["״]ן|(?<!\\d)1201(?!\\d)`);

// Signs that do not wait for a call back, in a person (a dog's go to the model).
const RED_FLAG = /(?:בקושי|קשה(?: לי)?|קושי(?: ב)?|לא מצליח\S*)\s*(?:לנשום|נושמ?ת?|נושם|נשימה|לבלוע|בולעת?|בליעה)|(?:לחץ|כאבים?)\s+(?:חזק\S*\s+)?ב?חזה|(?:נפוח|נפיחות)[^\n]{0,80}(?:חום|לבלוע|בולע|לנשום)/;
/** He describes one and the reply only promises a call back (25.11.2026, a swollen cheek with fever and trouble swallowing). */
export const withRedFlag = (reply: string, incoming: string): string =>
  RED_FLAG.test(incoming) && !/כלב|חתול/.test(incoming) && !/מיון|(?<!\d)101(?!\d)|מד["״]א/.test(reply) ? `עם סימנים כאלה לא מחכים: לפנות עכשיו לחדר מיון או להתקשר למד"א 101.\n\n${reply}` : reply;

/** The reply sent someone to emergency services: the number is always there, and a person gets the chat. */
export function emergencyReply(reply: string, incoming = ""): { reply: string; emergency: boolean } {
  if (!EMERGENCY.test(reply)) return { reply, emergency: false };
  return { reply: /(?<!\d)(101|1201)(?!\d)/.test(reply) || ANIMAL.test(incoming) ? reply : `${reply}\n\nמד"א: 101`, emergency: true };
}

/** "18:30 לא פנוי" about an hour the code found free (27.11.2026: said three times in one chat, and the customer left). */
export const deniesHour = (reply: string, hour: string): boolean =>
  reply.split(/[.!?\n|()]+/).some(s => s.includes(hour) && /(^|[^א-ת])(לא|אין|תפוס)(?![א-ת])|isn'?t|not available/i.test(s) && !/(^|[^א-ת])יש(?![א-ת])|(?<!לא )פנוי/.test(s));

const SELF_HARM = /(?:אין לי|אין לי שום|איבדתי(?: את)?(?: ה)?)\s*(?:כוח|חשק|סיבה|טעם)\s*(?:ל|ב)חיות|לא רוצה (?:לחיות|להיות פה|להמשיך לחיות)|(?:רוצה|בא לי) למות(?!\s*מ)|להתאבד|לפגוע בעצמי|לשים קץ|נמאס לי (?:לחיות|מהחיים)/;
/** He writes he doesn't want to live: the crisis line, a person, and nothing else (27.11.2026: "maybe general tiredness" and a booking offer). */
export const crisisReply = (reply: string, incoming: string): string | null =>
  SELF_HARM.test(incoming) && !/ער["״]ן|(?<!\d)1201(?!\d)/.test(reply)
    ? 'אני כאן ושומע אותך. אם יש מחשבות לפגוע בעצמך, אפשר לדבר עכשיו עם ער"ן בטלפון 1201, 24 שעות ביממה ובחינם. בסכנה מיידית: מד"א 101.\n\nהעברתי את ההודעה שלך לצוות, ויחזרו אליך בהקדם.'
    : null;

/** He named an hour ("3", "6 בערב") that is free, and the reply offers other hours without it (27.11.2026: "3" → "13:00?"). */
export const ignoresHour = (reply: string, hour: string): boolean => !reply.includes(hour) && /(?<!\d)\d{1,2}:\d{2}(?!\d)/.test(reply);

/** "אין מקום" with no hour in it, about a part of the day the code found free hours in (27.11.2026: "הצהריים יש משהו?"). */
export const deniesRange = (reply: string): boolean => /אין (?:מקום|תורים|שעות|כלום|משהו)|לא פנוי|תפוס|מלא(?![א-ת])/.test(reply) && !/(?<!\d)\d{1,2}:\d{2}(?!\d)/.test(reply);

const ANIMAL = /כלב|חתול|(?<![א-ת])גור(?![א-ת])|ארנב|תוכי|אוגר|\bdogs?\b|\bcats?\b|собак|кошк|كلب|قطة|قطتي/i;
/** 101 is the ambulance for people: a poisoned dog was sent there twice (27.11.2026). Those lines go; the vet's own advice stays. */
export function withoutHumanEmergency(reply: string, incoming: string): string {
  if (!ANIMAL.test(incoming) || !/(?<!\d)101(?!\d)|מד["״]א/.test(reply)) return reply;
  const kept = reply.split(/(?<=[.!?\n])/).filter(s => !/(?<!\d)101(?!\d)|מד["״]א/.test(s)).join("").trim();
  return kept || "זה מצב חירום: הגיעו עכשיו לחירום וטרינרי, בלי לחכות לתור.";
}
