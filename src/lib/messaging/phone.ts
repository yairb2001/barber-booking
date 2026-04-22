/** Normalize an Israeli phone to E.164 (972...) without '+' or leading zero. */
export function normalizeIsraeliPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  // Already international 972...
  if (digits.startsWith("972")) return digits;
  // Local 0XXXXXXXXX → drop leading 0, prepend 972
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  // Without leading 0, 9 digits: assume missing leading 0
  if (digits.length === 9) return "972" + digits;
  return digits;
}

/** Green API chat id format: <E.164-no-plus>@c.us */
export function toGreenChatId(phone: string): string {
  return normalizeIsraeliPhone(phone) + "@c.us";
}
