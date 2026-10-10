/**
 * The message diet (spec "אפיון מלא: מסלולים ורשמי", 10.10.2026, Yair:
 * "להוריד משמעותית את כמות ההודעות ... שתיהיה תזכורת אחת").
 *
 * Per appointment, instead of booking confirmation + 24h reminder + 2h
 * reminder (2.2 messages on DOMINANT):
 *   • one confirmation request, which is also the reminder. The owner sets
 *     how long before, whether a reply is required and what happens without
 *     one. On official WhatsApp the customer's reply opens the free 24h window.
 *   • the booking notice only when the SHOP booked it (a customer who booked
 *     on the site saw it on screen; in the chat the agent's reply is the notice).
 *   • an optional second reminder, off by default.
 *   • push instead of WhatsApp for a customer who installed the shop's app.
 *   • the agent's bubbles merged into one message.
 *
 * This IS the official-WhatsApp mode (Yair, 10.10.2026: "כל המצב הזה זה
 * לווצאפ רשמי, ברגע שבוחרים בהגדרות"): it runs only for a business whose
 * messagingProvider is "meta_cloud". Unofficial (our own server) keeps the
 * old flow as is. The owner's choices live in settings.msgFlow. Pure module
 * (no prisma) so the settings screen can import the defaults and labels.
 */

export type NoReply = "keep" | "owner" | "again" | "release";
export type MsgFlow = {
  confirm: { hoursBefore: number; required: boolean; waitHours: number; ifNoReply: NoReply };
  reminder: { on: boolean; hoursBefore: number };
  channel: "auto" | "whatsapp";
  bookingNotice: "staff_only" | "always";
  mergeBubbles: boolean;
};

export const MSG_FLOW_DEFAULTS: MsgFlow = {
  confirm: { hoursBefore: 24, required: false, waitHours: 4, ifNoReply: "owner" },
  reminder: { on: false, hoursBefore: 2 },
  channel: "auto",
  bookingNotice: "staff_only",
  mergeBubbles: true,
};

export const CONFIRM_HOURS = [48, 24, 12, 6, 3] as const;
export const WAIT_HOURS = [1, 2, 3, 4, 6, 12] as const;
export const REMINDER_HOURS = [1, 2, 3] as const;
export const NO_REPLY_LABEL: Record<NoReply, string> = {
  keep: "כלום, רק מסומן ביומן",
  owner: "התראה אליי",
  again: "לשאול שוב פעם אחת",
  release: "לבטל ולשחרר את המקום",
};

const pick = <T,>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

export const isOfficial = (b: { messagingProvider?: string | null }) => b.messagingProvider === "meta_cloud";

/** The business's flow, or null when it is not on official WhatsApp (old flow). */
export function getMsgFlow(b: { messagingProvider?: string | null; settings?: string | null }): MsgFlow | null {
  if (!isOfficial(b)) return null;
  let s: Record<string, unknown> = {};
  try { s = b.settings ? JSON.parse(b.settings) : {}; } catch { /* defaults */ }
  return normalizeMsgFlow(s.msgFlow as Partial<MsgFlow> | undefined);
}

export function normalizeMsgFlow(f: Partial<MsgFlow> | undefined): MsgFlow {
  const d = MSG_FLOW_DEFAULTS;
  const c = (f?.confirm ?? {}) as Partial<MsgFlow["confirm"]>;
  const r = (f?.reminder ?? {}) as Partial<MsgFlow["reminder"]>;
  return {
    confirm: {
      hoursBefore: pick(c.hoursBefore, CONFIRM_HOURS, d.confirm.hoursBefore),
      required: c.required === true,
      waitHours: pick(c.waitHours, WAIT_HOURS, d.confirm.waitHours),
      ifNoReply: pick(c.ifNoReply, ["keep", "owner", "again", "release"] as const, d.confirm.ifNoReply),
    },
    reminder: { on: r.on === true, hoursBefore: pick(r.hoursBefore, REMINDER_HOURS, d.reminder.hoursBefore) },
    channel: pick(f?.channel, ["auto", "whatsapp"] as const, d.channel),
    bookingNotice: pick(f?.bookingNotice, ["staff_only", "always"] as const, d.bookingNotice),
    mergeBubbles: f?.mergeBubbles !== false,
  };
}

/** The request line at the end of the reminder text. */
export function confirmAskLine(flow: MsgFlow, releaseAt?: string | null): string {
  if (!flow.confirm.required) return "לאישור התור השב 1 · לביטול השב 2";
  const line = "נא לאשר הגעה: השב 1 לאישור · 2 לביטול";
  return flow.confirm.ifNoReply === "release" && releaseAt ? `${line}\nבלי אישור עד ${releaseAt} התור משתחרר.` : line;
}

/** Message kinds the flow sends for an appointment (re-checked before sending). */
export const FLOW_KINDS = ["confirm_request", "confirm_followup", "appt_reminder"] as const;

/** Customer-facing kinds that go as push to a customer who has the app. */
export const PUSHABLE_KINDS = new Set<string>([
  "confirmation", "first_booking", "reminder_24h", "reminder_2h", ...FLOW_KINDS,
  "appointment_moved", "appointment_cancelled", "delay_notification", "waitlist_notify", "swap_confirmation",
  "rhythm_nudge", "rhythm_nudge_2", "rhythm_nudge_new", "reengage", "post_first_visit", "post_every_visit",
]);
