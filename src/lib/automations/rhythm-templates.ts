/** Default messages for "הגיע הזמן לתור" — no imports, so both the engine
 *  and the messaging template registry can depend on this without a cycle.
 *  {{at_staff}} = "לשימי " for a regular customer, "לנו " for a mixed one.
 *  {{options}} is one line per day ("ביום שלישי ה-22.9 ב13:00 או ב13:30",
 *  next line "או ביום רביעי ה-23.9 ב16:00"), so keep it on a line of its own. */
export const DEFAULT_RHYTHM_TEMPLATE =
`היי {{name}}, ראיתי שלא קבעת עדיין את התור הבא שלך, נראה שאתה צריך 😄
יש {{at_staff}}{{options}}
איזו שעה נוח שאקבע לך?`;
export const DEFAULT_RHYTHM_SECOND_TEMPLATE =
`היי {{name}}, עדיין יש {{at_staff}}{{options}}
לתפוס לך?`;
export const DEFAULT_RHYTHM_SECOND_TAKEN_TEMPLATE =
`היי {{name}}, השעות שהצעתי לך כבר נתפסו, אבל יש {{at_staff}}{{options}}
לתפוס לך?`;
export const DEFAULT_RHYTHM_NEW_TEMPLATE =
`היי {{name}}, איזה כיף שהסתפרת אצלנו בפעם שעברה 😊

אם בא לך לקבוע את הבא, יש {{options}}

אפשר גם לבקש ממני שעה או יום אחר, או לשריין לבד באתר:
{{booking_link}}

פשוט תגיד מה נוח לך.`;
