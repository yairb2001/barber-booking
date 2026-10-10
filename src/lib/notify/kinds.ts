/**
 * Notification center kinds (10.10.2026, Yair: "שם יהיה כל מה שעד כה נשלח
 * אליי לווצאפ ... לא כל תור שנקבע"). Only what used to reach the owner or a
 * barber by WhatsApp; bookings, cancellations and the waitlist stay plain push.
 * Pure module: the settings screen imports labels and defaults. The default is
 * WhatsApp, which keeps what each event did before the center existed.
 */
export type CenterKind = "agent_question" | "escalation" | "swap" | "closure" | "report" | "system";
export type Channel = "push" | "whatsapp" | "screen";

export const CENTER_KINDS: { kind: CenterKind; label: string; hint: string; def: Channel; whatsapp: boolean }[] = [
  { kind: "agent_question", label: "שאלות של הסוכן", hint: "לקוח שאל משהו שהסוכן לא יודע, ומחכה לתשובה שלך", def: "push", whatsapp: true },
  { kind: "escalation", label: "העברה לטיפול אנושי", hint: "הסוכן העביר לקוח אליך", def: "whatsapp", whatsapp: true },
  { kind: "swap", label: "החלפות ואיחורים", hint: "בקשות לאשר החלפה או איחור, ומה יצא מהן", def: "whatsapp", whatsapp: true },
  { kind: "closure", label: "סגירת יום", hint: "לקוח שלא ענה על ביטול, וסיכום הסגירה", def: "whatsapp", whatsapp: true },
  { kind: "report", label: "דוחות", hint: "סיכום יומי, שבועי וחודשי", def: "whatsapp", whatsapp: true },
  { kind: "system", label: "תקלות", hint: "וואטסאפ מנותק, חבילת הסוכן", def: "whatsapp", whatsapp: true },
];

export const CHANNEL_LABEL: Record<Channel, string> = { push: "למסך + פוש", whatsapp: "וואטסאפ", screen: "רק במסך" };

export function channelFor(settings: string | Record<string, unknown> | null | undefined, kind: CenterKind): Channel {
  let s: Record<string, unknown> = {};
  if (typeof settings === "string") { try { s = JSON.parse(settings); } catch { /* defaults */ } } else if (settings) s = settings;
  const prefs = (s.notifChannels ?? {}) as Record<string, string>;
  const def = CENTER_KINDS.find(k => k.kind === kind)!;
  const v = prefs[kind];
  if (v === "push" || v === "screen" || (v === "whatsapp" && def.whatsapp)) return v as Channel;
  return def.def;
}
