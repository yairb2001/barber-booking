/** Checks on the agent's reply before it is sent, and the wordings behind them (25.11.2026). No DB, no AI:
 *  npx tsx scripts/test-reply-guards.ts */
import { dropInventedPhones, dropRepeatedWaitlistAsk, emergencyReply, withAskOwnerPromise } from "../src/lib/agent/reply-guards";
import { staffFirst, staffShort } from "../src/lib/agent/staff-label";
import { askedWindow, namedServices } from "../src/lib/agent/availability-snapshot";
import { looksLikeProspect } from "../src/lib/agent/sales-agent";

let failed = 0;
const eq = (what: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${what}${ok ? "" : `: ${JSON.stringify(got)}`}`);
};

eq("an invented phone is taken out", dropInventedPhones("לגרר תוכל לפנות לרכב הצלה (04-6500600) או לביטוח", "050-1234567"), "לגרר תוכל לפנות לרכב הצלה או לביטוח");
eq("the business's phone stays", dropInventedPhones("התקשר 050-1234567", "טלפון: 972501234567"), "התקשר 050-1234567");
eq("101 and prices stay", dropInventedPhones("חייג 101, עולה 1200 שקל ב-16:00", ""), "חייג 101, עולה 1200 שקל ב-16:00");

eq("the waitlist is asked once", dropRepeatedWaitlistAsk("כן, בוט של המספרה\nרוצה שארשום אותך לרשימת המתנה אצל משה לראשון?", ["רוצה שאעדכן אותך אם יתפנה אצל משה ביום ראשון?"], "זה בוט?"), "כן, בוט של המספרה");
eq("another day is another offer", dropRepeatedWaitlistAsk("רוצה שאעדכן אותך אם יתפנה ביום שלישי?", ["רוצה שאעדכן אותך אם יתפנה ביום ראשון?"], "ומה עם שלישי?"), "רוצה שאעדכן אותך אם יתפנה ביום שלישי?");
eq("he said yes", dropRepeatedWaitlistAsk("רוצה שארשום אותך לרשימת המתנה לראשון?", ["רוצה שאעדכן אותך אם יתפנה בראשון?"], "כן"), "רוצה שארשום אותך לרשימת המתנה לראשון?");

eq("an emergency always has the number", emergencyReply("פנה מיד לחדר מיון"), { reply: "פנה מיד לחדר מיון\n\nמד\"א: 101", emergency: true });
eq("sent to 101", emergencyReply("התקשרי עכשיו ל-101").emergency, true);
eq("a mention is not an emergency", emergencyReply("מקווה שהכל בסדר בחדר המיון, לבטל את התור?").emergency, false);
eq("a price is not an emergency", emergencyReply("המחיר 101 ₪").emergency, false);
eq("the lost promise is said", withAskOwnerPromise("בינתיים, רוצה לקבוע?", true), "אני בודק את זה וחוזר אליך.\n\nבינתיים, רוצה לקבוע?");

eq("a title is not a name", [staffShort('ד"ר רון גל'), staffFirst('ד"ר רון גל'), staffShort("יאיר בוחבוט")], ['ד"ר רון', "רון", "יאיר"]);
eq("the asked hours", [["מחר בערב?"], ["ב17:00 אצל רז"], ["תור"]].map(t => askedWindow(t, "2026-11-25")), [{ from: 1020, to: 1440 }, { from: 960, to: 1170 }, null]);
const cuts = [{ id: "cut", name: "תספורת" }, { id: "both", name: "תספורת + זקן" }, { id: "kid", name: "תספורת ילד" }];
eq("the named treatment", ["תספורת רגילה", "בעצם תספורת וזקן", "תספורת בלי זקן"].map(t => namedServices(t, cuts)[0]), ["cut", "both", "cut"]);

const owners = ["אני בעלת מספרת נשים ברחובות, זה מתאים לי?", "יש לי 4 ספריות וכל אחת עושה משהו אחר", "יש לי סטודיו לציפורניים, איך זה עובד?", "אני רופא משפחה, יש לכם פתרון למרפאה?", "מרפאת שיניים, זה עובד אצלנו?", "יש לי מוסך, רלוונטי?", "מאמן כושר, יש לי גם שיעורים קבוצתיים", "אנחנו בעלים של מכון יופי"];
const customers = ["12:00 מתאים לי", "זה מתאים לי", "תספורת לבעל שלי", "אני צריכה תור לציפורניים", "יש לי תור מחר?", "יש לכם תספורת גברים?", "זה בסדר, 17:00", "הבעל שלי רוצה תספורת", "אפשר אצל מיכל?"];
eq("a business owner leaves the demo", owners.filter(t => !looksLikeProspect(t, "demo")), []);
eq("a customer stays in it", customers.filter(t => looksLikeProspect(t, "demo")), []);

process.exit(failed ? 1 : 0);
