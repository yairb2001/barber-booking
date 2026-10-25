/**
 * The ready reasons on "דווח" under an agent message in the shop's chats
 * (25.10.2026). The owner taps one or more and may add his own words; they are
 * stored at the start of the report's text. No server imports: used by the
 * chats screen and by /api/admin/agent/feedback.
 */
export const REPORT_REASONS = ["מידע לא נכון", "לא הבין את הלקוח", "שעה או תור לא נכונים", "נשמע לא טבעי", "היה צריך להעביר אליי"] as const;
