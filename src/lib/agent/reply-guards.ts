/**
 * Checks on the agent's reply before it is sent, in code (25.11.2026, the test
 * of 13 business types). Each one is a promise the model broke in a real chat.
 */

const PHONE = /(?:\+?972[-\s]?|(?<!\d)0)(?:[23489]|5\d|7\d)[-\s]?\d{3}[-\s]?\d{4}(?!\d)/g;
const digits = (s: string) => s.replace(/\D/g, "");

/** A phone number that appears nowhere in what the agent was given is invented
 *  ("גרר 04-6500600", a garage's agent made it up). It is taken out of the reply. */
export function dropInventedPhones(reply: string, known: string): string {
  const ref = digits(known);
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
export function emergencyReply(reply: string): { reply: string; emergency: boolean } {
  if (!EMERGENCY.test(reply)) return { reply, emergency: false };
  return { reply: /(?<!\d)(101|1201)(?!\d)/.test(reply) ? reply : `${reply}\n\nמד"א: 101`, emergency: true };
}
