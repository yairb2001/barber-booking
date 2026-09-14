/** Default messages for "הגיע הזמן לתור" — no imports, so both the engine
 *  and the messaging template registry can depend on this without a cycle.
 *  {{at_staff}} = "אצל שימי " for a regular customer, "" for a mixed one. */
export const DEFAULT_RHYTHM_TEMPLATE =
`היי {{name}}, ראיתי שלא קבעת עדיין את התור הבא שלך, נראה שאתה צריך 😄
יש לנו {{at_staff}}{{options}}.
איזו שעה נוח שאקבע לך?`;
export const DEFAULT_RHYTHM_SECOND_TEMPLATE =
`היי {{name}}, עדיין פנוי {{at_staff}}{{options}} — לתפוס לך?`;
export const DEFAULT_RHYTHM_SECOND_TAKEN_TEMPLATE =
`היי {{name}}, השעות שהצעתי לך כבר נתפסו, אבל יש {{at_staff}}{{options}} — לתפוס לך?`;
export const DEFAULT_RHYTHM_NEW_TEMPLATE =
`היי {{name}}, איזה כיף שהסתפרת אצלנו בפעם שעברה 😊

אם בא לך לקבוע את הבא, יש {{options}}.

אפשר גם לבקש ממני שעה או יום אחר, או לשריין לבד באתר:
{{booking_link}}

פשוט תגיד מה נוח לך.`;
