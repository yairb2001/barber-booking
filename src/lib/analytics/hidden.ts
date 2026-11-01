/**
 * Hidden appointments (Appointment.hiddenAt, see /api/admin/appointments/[id]) stay out of
 * every dashboard number. "הצג תורים מוסתרים" in the dashboard ⋯ menu sends ?includeHidden=1
 * to bring them back (owner, 1.11.2026). Reports, availability and the calendar day count
 * keep counting them.
 */
export function hiddenWhere(searchParams: URLSearchParams): { hiddenAt?: null } {
  return searchParams.get("includeHidden") === "1" ? {} : { hiddenAt: null };
}
