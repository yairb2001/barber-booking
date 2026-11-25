/** Checks on the agent's reply before it is sent, and the wordings behind them (25.11.2026). No DB, no AI:
 *  npx tsx scripts/test-reply-guards.ts */
import { dropInventedPhones, dropRepeatedWaitlistAsk, dropWaitlistForDayOff, emergencyReply, withAskOwnerPromise, withoutHtml } from "../src/lib/agent/reply-guards";
import { staffFirst, staffShort } from "../src/lib/agent/staff-label";
import { askedWindow, namedServices, workDaysIn } from "../src/lib/agent/availability-snapshot";
import { correctHebrewWeekdayLabels, policyGapGuidance, situationalGuidance } from "../src/lib/agent/customer-agent";
import { aboutHisAppointment, asksToCancel, cancelBesideNewTime, finishBy, hourInWords, yesToCancelAndRebook, nameAtEnd, nameWithRequest, offeredHour, requestBesideName, requestBesideYes, wantsIfOpens } from "../src/lib/agent/mixed-messages";
import { nearestId } from "../src/lib/agent/repair-ids";
import { vocabFor } from "../src/lib/vocab";
import { addDaysISO, getBusinessNow } from "../src/lib/utils";
import { agentReplyForType } from "../src/lib/type-wording";
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

const days = workDaysIn("(ימי עבודה קבועים: משה שני, שלישי | ד\"ר רון ראשון (יום אחר = לא עובדים בו))");
eq("the work days are read back", days, [{ name: "משה", days: ["שני", "שלישי"] }, { name: "ד\"ר רון", days: ["ראשון"] }]);
eq("no waitlist for a day off", dropWaitlistForDayOff("בסדר.\nרוצה שאעדכן אותך אם יתפנה אצל משה ביום ראשון?", days), "בסדר.");
eq("a work day keeps it", dropWaitlistForDayOff("רוצה שאעדכן אותך אם יתפנה אצל משה ביום שני?", days), "רוצה שאעדכן אותך אם יתפנה אצל משה ביום שני?");
eq("no html", withoutHtml("מה שמו?\n<br>\n(על שמך)"), "מה שמו?\n\n(על שמך)");
const clinic = vocabFor("other");
eq("nothing written about the funds", policyGapGuidance("אתם עובדים עם מכבי?", "תשלום: אשראי", clinic).includes("קופות חולים"), true);
eq("written", policyGapGuidance("אתם עובדים עם מכבי?", "עובדים עם מכבי וכללית", clinic), "");
eq("slang is not a brother", situationalGuidance("אהלן אחי יש משהו מחר?", [], undefined, true), "");
eq("a brother is", situationalGuidance("תור לי ולאחי", [], undefined, true) !== "", true);
eq("DOMINANT's guidance is as it was", situationalGuidance("אהלן אחי יש משהו מחר?", []) !== "", true);
// Two things in one message.
eq("a request beside a yes", ["כן תודה. אגב כמה זה?", "כן. אפשר להביא את הילדה?", "כן\nותבטלי את של יום שני"].map(requestBesideYes), ["אגב כמה זה?", "אפשר להביא את הילדה?", "ותבטלי את של יום שני"]);
eq("a yes alone", ["כן", "כן תודה", "מאשר 👍", "כן רק תספורת בלי זקן", "סבבה אחי נתראה", "לא, כמה זה?"].map(requestBesideYes), [null, null, null, null, null, null]);
eq("a name beside a question", ["קרן אור, רגע כמה זה ומה הכתובת?", "לוי. אז גדול זה בסדר?", "לא, יש מאוחר יותר?"].map(t => nameWithRequest(t)?.name ?? null), [{ full: "קרן אור" }, { partial: "לוי" }, null]);
eq("a name at the end", ["ראשון ב11, מורן שי", "ראשון בבוקר 9:30, זיו הראל", "מחר ב10, בלי זקן", "ב10 אצל דנה", "מחר, דנה לוי"].map(nameAtEnd), ["מורן שי", "זיו הראל", null, null, null]);
eq("cancel beside a new time", [["18:30 ותבטל לי את רביעי", "11:00"], ["08:30. ואז את ביום ראשון תבטלי", "09:00"], ["לבטל את התור של 11:00", "11:00"], ["לבטל את 26.11", "11:00"], ["לבטל בבקשה", "11:00"]].map(([t, c]) => cancelBesideNewTime(t, c)), [true, true, false, false, false]);
eq("asks to cancel", ["18:30 ותבטל לי את רביעי", "ואז את ראשון תבטלי", "אל תבטל", "אם מישהו מבטל תעדכן", "עד מתי אפשר לבטל?"].map(asksToCancel), [true, true, false, false, false]);
eq("what he would rather have", ["תקבעי לי בינתיים מחר ב10 ואם מתפנה היום אחרי 16 תגידי. ענת צור", "ואם מתפנה משהו תעדכן", "מחר ב10"].map(wantsIfOpens), ["היום אחרי 16", "משהו מוקדם יותר", null]);
eq("a question beside the name", [requestBesideName("קרן אור, רגע כמה זה ומה הכתובת?"), requestBesideName("קרן אור, תודה"), requestBesideName("קרן אור")], ["רגע כמה זה ומה הכתובת?", null, null]);
eq("the offered hour", [offeredHour("רשום ב-12:30. רוצה שאזיז אותו ל-11:30?", "12:30"), offeredHour("יש 10:00 או 11:00, מה עדיף?", "12:30"), offeredHour("להזיז את התור?", "12:30")], ["11:30", null, null]);
const ids = ["0e9e10ce-ad55-46c1-822f-15d3e3c0c8d0", "efbf1a36-a8a9-4c71-9c26-ff4937da7b17"];
eq("an id with one slip", [nearestId("0e9e10ce-ad55-46c1-822f-15d3e3c0b8d0", ids), nearestId(ids[1], ids), nearestId("11111111-ad55-46c1-822f-15d3e3c0c8d0", ids), nearestId("רז", ids)], [ids[0], null, null, null]);
eq("must finish by", ["חייב לצאת עד 14", "אני חייבת לצאת ב1 אין משהו לפני?", "לסיים לפני 13:30", "אפשר ב14?", "ללכת ב30.11"].map(finishBy), [840, 780, 810, null, null]);
eq("about his appointment", [aboutHisAppointment("תקוע עם פנצ'ר", true) !== "", aboutHisAppointment("תקוע עם פנצ'ר", false), aboutHisAppointment("שיניתי ל11:30", true).includes("לא נשמר"), aboutHisAppointment("תודה", true)], [true, "", true, ""]);

eq("yes to cancel and rebook", [["כן", "לבטל את התור ב-18:00 ולקבוע ב-20:00?"], ["כן", "לבטל את התור ב-18:00?"], ["כן 21:00", "לבטל את התור ב-18:00 ולקבוע ב-20:00?"], ["לא", "לבטל את התור ב-18:00 ולקבוע ב-20:00?"]].map(([t, q]) => yesToCancelAndRebook(t, q, "18:00")), ["20:00", null, null, null]);
eq("an hour in words", ["אפשר שלוש ועשרה במקום?", "רבע לחמש", "ארבע וחצי", "בשעה עשר וחצי", "אחת עשרה ורבע", "יש שלוש ילדות", "רבע לאחת"].map(hourInWords), ["3:10", "4:45", "4:30", "10:30", "11:15", null, "12:45"]);
const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const dayIn = (n: number) => DAY[new Date(`${addDaysISO(getBusinessNow().date, n)}T12:00:00Z`).getUTCDay()];
eq("מחר with the wrong weekday", correctHebrewWeekdayLabels(`הכי קרוב זה מחר ${dayIn(2)}. יש 09:00`), `הכי קרוב זה ביום ${dayIn(2)}. יש 09:00`);
eq("מחר with the right one", correctHebrewWeekdayLabels(`מחר ${dayIn(1)}, 09:00`), `מחר ${dayIn(1)}, 09:00`);
eq("מחר שני תורים stays", correctHebrewWeekdayLabels("מחר שני תורים פנויים"), "מחר שני תורים פנויים");
eq("a long dash after a date", agentReplyForType("ביום שני 30.11 — 10:00, 11:00", vocabFor("barber_men")), "ביום שני 30.11, 10:00, 11:00");
eq("a range keeps it", agentReplyForType("10:00 — 12:00", vocabFor("barber_men")), "10:00 — 12:00");

process.exit(failed ? 1 : 0);
