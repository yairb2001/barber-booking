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

const PROMISED = /בודק|אבדוק|לבדוק|בדקתי|אחזור|חוזר|יחזרו|אברר|מברר|שאלתי|שלחתי|העברתי|מעביר|check|get back/i;

/** ask_owner ran, but the sentence that says so came before the tool call and was lost. */
export function withAskOwnerPromise(reply: string, asked: boolean): string {
  return asked && !PROMISED.test(reply) ? `אני בודק את זה וחוזר אליך.\n\n${reply}` : reply;
}

// "Go there now", not a mention ("מקווה שהכל בסדר בחדר המיון").
const GO = "(?:פנה|פני|פנו|לפנות|תפנה|גש|גשי|לגשת|לך|לכי|ללכת|להגיע|חייג|חייגי|לחייג|התקשר|התקשרי|להתקשר)";
const EMERGENCY = new RegExp(`${GO}[^\\n]{0,40}(?:חדרי? ה?מיון|מד["״]א|(?<!\\d)(?:101|1201)(?!\\d))|חדר ה?מיון (?:מיד|מייד|עכשיו)|ער["״]ן|(?<!\\d)1201(?!\\d)`);

/** The reply sent someone to emergency services: the number is always there, and a person gets the chat. */
export function emergencyReply(reply: string): { reply: string; emergency: boolean } {
  if (!EMERGENCY.test(reply)) return { reply, emergency: false };
  return { reply: /(?<!\d)(101|1201)(?!\d)/.test(reply) ? reply : `${reply}\n\nמד"א: 101`, emergency: true };
}
