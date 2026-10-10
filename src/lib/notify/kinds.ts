/**
 * Notification center kinds (10.10.2026). Pure module: the settings screen
 * imports the labels and defaults. A default keeps what each event did before
 * the center existed, so nobody's notifications change until they choose.
 */
export type CenterKind = "agent_question" | "escalation" | "booking" | "cancellation" | "waitlist" | "swap" | "report" | "system";
export type Channel = "push" | "whatsapp" | "screen";

export const CENTER_KINDS: { kind: CenterKind; label: string; hint: string; def: Channel; whatsapp: boolean }[] = [
  { kind: "agent_question", label: "שאלות של הסוכן", hint: "לקוח שאל משהו שהסוכן לא יודע, ומחכה לתשובה שלך", def: "push", whatsapp: true },
  { kind: "escalation", label: "העברה לטיפול אנושי", hint: "הסוכן העביר לקוח אליך", def: "whatsapp", whatsapp: true },
  { kind: "booking", label: "תור חדש", hint: "לקוח קבע תור באתר או אצל הסוכן", def: "push", whatsapp: false },
  { kind: "cancellation", label: "ביטול תור", hint: "לקוח ביטל", def: "push", whatsapp: false },
  { kind: "waitlist", label: "רשימת המתנה", hint: "מישהו נרשם או קיבל מקום", def: "push", whatsapp: false },
  { kind: "swap", label: "החלפות והזזות", hint: "בקשות להחליף או להזיז תורים", def: "whatsapp", whatsapp: true },
  { kind: "report", label: "דוחות", hint: "סיכום יומי, שבועי וחודשי", def: "whatsapp", whatsapp: true },
  { kind: "system", label: "תקלות", hint: "וואטסאפ מנותק, חבילת הסוכן", def: "whatsapp", whatsapp: true },
];

export const CHANNEL_LABEL: Record<Channel, string> = { push: "פוש", whatsapp: "וואטסאפ", screen: "רק במסך" };

export function channelFor(settings: string | Record<string, unknown> | null | undefined, kind: CenterKind): Channel {
  let s: Record<string, unknown> = {};
  if (typeof settings === "string") { try { s = JSON.parse(settings); } catch { /* defaults */ } } else if (settings) s = settings;
  const prefs = (s.notifChannels ?? {}) as Record<string, string>;
  const def = CENTER_KINDS.find(k => k.kind === kind)!;
  const v = prefs[kind];
  if (v === "push" || v === "screen" || (v === "whatsapp" && def.whatsapp)) return v as Channel;
  // No choice yet: an old push toggle switched off means "screen only".
  const legacy: Partial<Record<CenterKind, string>> = { booking: "notifyOnAppointments", cancellation: "notifyOnCancellation", waitlist: "notifyOnWaitlist" };
  if (legacy[kind] && s[legacy[kind]!] === false) return "screen";
  return def.def;
}
