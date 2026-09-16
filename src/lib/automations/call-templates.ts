/** Default messages for "התקשרת? אני כאן" (phone-call automation) — no
 *  imports, so both the engine and the messaging template registry can depend
 *  on this without a cycle. See specs/call-automation.md §4.
 *  Style: human, flowing, almost no emoji, and clearly an AI agent. */

/** A — unknown number, we missed the call. {{options}} = up to 3 nearest slots across the quick pool. */
export const DEFAULT_CALL_NEW_MISSED_TEMPLATE =
`היי, כאן הסוכן הדיגיטלי של {{business}}. ראיתי שהתקשרת ולא הספקנו לענות, סליחה על זה.
{{options_line}}
אפשר גם לבחור לבד באתר: {{booking_link}}
ואם צריך משהו אחר — פשוט תכתוב לי פה.`;

/** B — unknown number, we answered. Neutral: introduces the agent, nothing more. */
export const DEFAULT_CALL_NEW_ANSWERED_TEMPLATE =
`היי, כאן הסוכן הדיגיטלי של {{business}}, נעים להכיר.
מעכשיו אפשר לכתוב לי כאן בכל שעה — תורים, שינויים, שאלות — ואני מסדר.
לקבוע לבד באתר: {{booking_link}}`;

/** C — known customer with an appointment in the next 24h, missed. */
export const DEFAULT_CALL_KNOWN_MISSED_UPCOMING_TEMPLATE =
`היי {{name}}, ראיתי שהתקשרת ולא הספקנו לענות.
אם זה לגבי התור שלך {{appt_when}} אצל {{staff}} — מאחר, להזיז או לבטל — תכתוב לי כאן ואני מסדר.
ואם זה משהו אחר, אני כאן.`;

/** D — known customer, no upcoming appointment, missed. {{staff_or_team}} = regular barber or "מישהו מהצוות". */
export const DEFAULT_CALL_KNOWN_MISSED_TEMPLATE =
`היי {{name}}, ראיתי שהתקשרת ולא הספקנו לענות.
אני כאן לכל דבר — לקבוע, להזיז, לשאול. ואם אתה צריך לדבר עם {{staff_or_team}}, תגיד לי ואבקש שיחזרו אליך.`;

/** The line that carries {{options}} in A; dropped when nothing is free in the next week. */
export const CALL_OPTIONS_LINE = `אם בא לך לקבוע תור בינתיים, יש {{options}} — תגיד לי מה מתאים ואני קובע.`;
