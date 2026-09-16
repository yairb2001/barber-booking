/**
 * "התקשרת? אני כאן" — phone-call automation (specs/call-automation.md).
 *
 * The shop phone (MacroDroid) or a telephony webhook reports every call to the
 * shop's number; we record it and, right away, open a WhatsApp conversation
 * with the caller:
 *   A  unknown number, missed   → AI intro + 3 nearest slots + link + "write here"
 *   B  unknown number, answered → neutral intro + link (the barber books from the chat)
 *   C  known, appt in 24h, missed → reminds the appointment: late / move / cancel
 *   D  known, no appt, missed   → "I'm here for anything" + push to their barber
 *   known + answered → nothing.
 * Guards: one message per number per 24h, not blocked / opted-out, not staff
 * numbers, not on Shabbat. Sent immediately (not through the drip queue).
 */
import { prisma } from "@/lib/prisma";
import { normalizeIsraeliPhone, phoneVariants } from "@/lib/messaging/phone";
import { sendMessage, applyTemplate, firstName, staffDisplayName, formatBusinessName } from "@/lib/messaging";
import { buildAvailabilityIndex } from "@/lib/availability-index";
import { getBusinessNow, getDayOfWeekISO, addDaysISO, timeToMinutes } from "@/lib/utils";
import { formatOptions, type Slot } from "@/lib/automations/rhythm-nudge";
import { pushChatEvent, regularStaffFor } from "@/lib/native/chat-push";
import {
  DEFAULT_CALL_NEW_MISSED_TEMPLATE, DEFAULT_CALL_NEW_ANSWERED_TEMPLATE,
  DEFAULT_CALL_KNOWN_MISSED_UPCOMING_TEMPLATE, DEFAULT_CALL_KNOWN_MISSED_TEMPLATE, CALL_OPTIONS_LINE,
} from "@/lib/automations/call-templates";

export type CallCase = "A" | "B" | "C" | "D";
export type CallSettings = { enabled: boolean; newMissed: boolean; newAnswered: boolean; knownMissedUpcoming: boolean; knownMissed: boolean };
export const CALL_DEFAULTS: CallSettings = { enabled: false, newMissed: true, newAnswered: true, knownMissedUpcoming: true, knownMissed: true };
export const CALL_KIND: Record<CallCase, "call_new_missed" | "call_new_answered" | "call_known_missed_upcoming" | "call_known_missed"> = {
  A: "call_new_missed", B: "call_new_answered", C: "call_known_missed_upcoming", D: "call_known_missed",
};
export const CALL_KINDS = Object.values(CALL_KIND);
const DAY = 86_400_000;

export function getCallSettings(raw: string | null | undefined): CallSettings {
  try {
    const s = raw ? JSON.parse(raw) : {};
    const c = (s.callAutomation && typeof s.callAutomation === "object") ? s.callAutomation : {};
    return {
      enabled: c.enabled === true,
      newMissed: c.newMissed !== false,
      newAnswered: c.newAnswered !== false,
      knownMissedUpcoming: c.knownMissedUpcoming !== false,
      knownMissed: c.knownMissed !== false,
    };
  } catch { return { ...CALL_DEFAULTS }; }
}

export type CallInput = {
  businessId: string;
  phone: string;
  direction: "in" | "out";
  outcome: "answered" | "missed";
  at?: Date;
  durationSec?: number;
  device?: string | null;
  /** Tests: do everything except the WhatsApp send and the push (the log row gets status "dry_run"). */
  dryRun?: boolean;
};
export type CallResult = { callEventId: string | null; case: CallCase | "none"; reason: string; sent: boolean; body?: string };

/** Israeli mobile/landline after normalization: 972 + 8–9 digits. Rejects hidden / foreign numbers. */
function isIsraeliNumber(n: string): boolean { return /^972\d{8,9}$/.test(n); }

/** Up to 3 nearest free slots across the quick pool over the next 7 days, ≥2 days when possible. */
async function nearestSlots(businessId: string, todayISO: string): Promise<Slot[]> {
  const index = await buildAvailabilityIndex(businessId, todayISO, 7);
  const nowMin = getBusinessNow().minutes;
  const out: Slot[] = [];
  const seen = new Set<string>();
  for (let d = 0; d < 7 && out.length < 3; d++) {
    const date = addDaysISO(todayISO, d);
    const perDay: Slot[] = [];
    for (const st of index.staffByLoad(date)) {
      for (const t of index.slots(st.id, date, null)) {
        if (d === 0 && timeToMinutes(t) < nowMin) continue;
        const k = `${date}|${t}`; if (seen.has(k)) continue;
        seen.add(k); perDay.push({ date, time: t, staffId: st.id, staffName: st.name, preferred: false });
      }
    }
    perDay.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
    // 2 from the first day that has something, then 1 from a later day.
    out.push(...perDay.slice(0, out.length === 0 ? 2 : 1));
  }
  return out.slice(0, 3);
}

/** "היום ב-14:30" / "מחר ב-10:00" / "יום רביעי ב-16:00" */
function apptWhen(dateISO: string, time: string, todayISO: string): string {
  const diff = Math.round((new Date(dateISO + "T00:00:00Z").getTime() - new Date(todayISO + "T00:00:00Z").getTime()) / DAY);
  const day = diff === 0 ? "היום" : diff === 1 ? "מחר" : `יום ${["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"][getDayOfWeekISO(dateISO)]}`;
  return `${day} ב-${time}`;
}

/** Find (or open) the customer-facing conversation and mirror what we sent, as the agent. */
async function mirrorAsAgent(businessId: string, phone: string, body: string, systemNote: string): Promise<string> {
  let conv = await prisma.conversation.findFirst({ where: { businessId, phone, agentType: { not: "owner" } }, orderBy: { createdAt: "desc" } });
  if (!conv) conv = await prisma.conversation.create({ data: { businessId, phone, agentType: "customer", status: "active" } });
  await prisma.conversationMessage.createMany({ data: [
    { conversationId: conv.id, role: "system", source: "system", content: systemNote },
    { conversationId: conv.id, role: "assistant", source: "agent", content: body },
  ] });
  await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
  return conv.id;
}

export async function handleCallEvent(input: CallInput): Promise<CallResult> {
  const at = input.at ?? new Date();
  const phone = normalizeIsraeliPhone(input.phone);
  if (!isIsraeliNumber(phone)) return { callEventId: null, case: "none", reason: "not_israeli_number", sent: false };

  // Idempotent: the same call reported twice (retries, two macros) is one event.
  const dup = await prisma.callEvent.findFirst({
    where: { businessId: input.businessId, phone, direction: input.direction, at: { gte: new Date(at.getTime() - 60_000), lte: new Date(at.getTime() + 60_000) } },
    select: { id: true, case: true, reason: true, messageLogId: true },
  });
  if (dup) return { callEventId: dup.id, case: (dup.case as CallCase | "none") ?? "none", reason: "duplicate", sent: !!dup.messageLogId };

  const [biz, staffPhones, customer] = await Promise.all([
    prisma.business.findUnique({ where: { id: input.businessId }, select: {
      name: true, slug: true, phone: true, settings: true,
      callNewMissedTemplate: true, callNewAnsweredTemplate: true, callKnownMissedUpcomingTemplate: true, callKnownMissedTemplate: true,
    } }),
    prisma.staff.findMany({ where: { businessId: input.businessId, phone: { not: null } }, select: { phone: true } }),
    prisma.customer.findFirst({ where: { businessId: input.businessId, deletedAt: null, phone: { in: phoneVariants(phone) } }, select: { id: true, name: true, isBlocked: true, messagingOptOut: true } }),
  ]);
  if (!biz) return { callEventId: null, case: "none", reason: "no_business", sent: false };

  const event = await prisma.callEvent.create({ data: {
    businessId: input.businessId, phone, customerId: customer?.id ?? null, direction: input.direction, outcome: input.outcome,
    at, durationSec: input.durationSec ?? 0, device: input.device ?? null,
  } });
  const finish = async (c: CallCase | "none", reason: string, messageLogId?: string | null, body?: string): Promise<CallResult> => {
    await prisma.callEvent.update({ where: { id: event.id }, data: { case: c, reason, messageLogId: messageLogId ?? null } });
    return { callEventId: event.id, case: c, reason, sent: !!messageLogId, body };
  };

  if (input.direction === "out") return finish("none", "outgoing");
  const teamPhones = new Set([...staffPhones.map(s => normalizeIsraeliPhone(s.phone!)), biz.phone ? normalizeIsraeliPhone(biz.phone) : ""].filter(Boolean));
  if (teamPhones.has(phone)) return finish("none", "staff_number");

  const cfg = getCallSettings(biz.settings);
  if (!cfg.enabled) return finish("none", "off");

  // ── Which case? ──
  const { date: todayISO } = getBusinessNow();
  let kase: CallCase | "none" = "none";
  let upcoming: { date: Date; startTime: string; staffName: string } | null = null;
  if (!customer) {
    kase = input.outcome === "missed" ? "A" : "B";
  } else if (input.outcome === "answered") {
    return finish("none", "known_answered");
  } else {
    const now = new Date();
    const todayUTC = new Date(todayISO + "T00:00:00.000Z");
    const appts = await prisma.appointment.findMany({
      where: { businessId: input.businessId, customerId: customer.id, status: { in: ["pending", "confirmed"] }, date: { gte: todayUTC, lte: new Date(todayUTC.getTime() + 2 * DAY) } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }], select: { date: true, startTime: true, staff: { select: { name: true } } },
    });
    for (const a of appts) {
      const dISO = a.date.toISOString().slice(0, 10);
      const [h, m] = a.startTime.split(":").map(Number);
      const startsAt = new Date(new Date(dISO + "T00:00:00+03:00").getTime() + (h * 60 + m) * 60_000); // Israel wall clock (±DST slack is fine here)
      if (startsAt.getTime() >= now.getTime() - 60 * 60_000 && startsAt.getTime() <= now.getTime() + DAY) { upcoming = { date: a.date, startTime: a.startTime, staffName: a.staff.name }; break; }
    }
    kase = upcoming ? "C" : "D";
  }
  const toggle: Record<CallCase, boolean> = { A: cfg.newMissed, B: cfg.newAnswered, C: cfg.knownMissedUpcoming, D: cfg.knownMissed };
  if (!toggle[kase]) return finish("none", `case_${kase}_off`);

  // ── Guards ──
  if (customer?.isBlocked) return finish("none", "blocked");
  if (customer?.messagingOptOut) return finish("none", "opted_out");
  if (getDayOfWeekISO(todayISO) === 6) return finish("none", "shabbat");
  const recent = await prisma.messageLog.findFirst({
    where: { businessId: input.businessId, customerPhone: { in: phoneVariants(phone) }, kind: { in: CALL_KINDS }, createdAt: { gte: new Date(Date.now() - DAY) }, status: { not: "failed" } },
    select: { id: true },
  });
  if (recent) return finish("none", "sent_24h");

  // ── Build the message ──
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
  const teamNames = (await prisma.staff.findMany({ where: { businessId: input.businessId, isAvailable: true }, select: { name: true } })).map(s => s.name);
  const vars: Record<string, string> = {
    name: customer ? firstName(customer.name) : "",
    business: formatBusinessName(biz.name),
    booking_link: `${baseUrl}${biz.slug ? `/${biz.slug}` : ""}/book`,
    options: "", options_line: "", appt_when: "", staff: "", staff_or_team: "מישהו מהצוות",
  };
  if (kase === "A") {
    const slots = await nearestSlots(input.businessId, todayISO).catch(() => [] as Slot[]);
    if (slots.length) {
      vars.options = formatOptions(slots, todayISO, true, teamNames);
      vars.options_line = applyTemplate(CALL_OPTIONS_LINE, { options: vars.options });
    }
  }
  if (kase === "C" && upcoming) {
    vars.appt_when = apptWhen(upcoming.date.toISOString().slice(0, 10), upcoming.startTime, todayISO);
    vars.staff = staffDisplayName(upcoming.staffName, teamNames);
  }
  if (kase === "D") {
    const regularId = await regularStaffFor(input.businessId, phone).catch(() => null);
    if (regularId) {
      const st = await prisma.staff.findUnique({ where: { id: regularId }, select: { name: true } });
      if (st) vars.staff_or_team = staffDisplayName(st.name, teamNames);
    }
  }
  const tmpl = kase === "A" ? (biz.callNewMissedTemplate || DEFAULT_CALL_NEW_MISSED_TEMPLATE)
    : kase === "B" ? (biz.callNewAnsweredTemplate || DEFAULT_CALL_NEW_ANSWERED_TEMPLATE)
    : kase === "C" ? (biz.callKnownMissedUpcomingTemplate || DEFAULT_CALL_KNOWN_MISSED_UPCOMING_TEMPLATE)
    : (biz.callKnownMissedTemplate || DEFAULT_CALL_KNOWN_MISSED_TEMPLATE);
  const body = applyTemplate(tmpl, vars).replace(/\n{3,}/g, "\n\n").trim();

  // ── Send (immediately), mirror, push ──
  const result = input.dryRun
    ? { ok: true as const }
    : await sendMessage({ businessId: input.businessId, customerPhone: phone, kind: CALL_KIND[kase], body });
  const log = input.dryRun
    ? await prisma.messageLog.create({ data: { businessId: input.businessId, customerPhone: phone, kind: CALL_KIND[kase], body, status: "dry_run" }, select: { id: true } })
    : await prisma.messageLog.findFirst({ where: { businessId: input.businessId, customerPhone: phone, kind: CALL_KIND[kase] }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const timeLabel = at.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
  const caseLabel: Record<CallCase, string> = { A: "חדש / לא נענה", B: "חדש / נענה", C: "קיים / תור קרוב", D: "קיים / לא נענה" };
  const convId = await mirrorAsAgent(input.businessId, phone, body,
    `📞 התקשר ${input.outcome === "missed" ? "ולא נענה" : "ונענה"} · ${timeLabel} · נשלחה הודעה "${caseLabel[kase]}"`).catch(() => null);
  if (!result.ok) return finish(kase, `send_failed: ${result.error ?? ""}`.trim(), log?.id, body);

  if (kase === "D" && convId && customer && !input.dryRun) {
    await pushChatEvent({
      businessId: input.businessId, conversationId: convId, phone, event: "escalation",
      payload: {
        title: `📞 ${customer.name} התקשר ולא נענה`, body: "נשלחה לו הודעה — כדאי לחזור אליו",
        url: `/admin/chats?phone=${encodeURIComponent(phone)}`, tag: `call-${event.id}`,
        actions: [{ action: "chat", title: "פתח צ׳אט" }], actionUrls: { chat: `/admin/chats?phone=${encodeURIComponent(phone)}` },
      },
    }).catch(() => {});
  }
  return finish(kase, "sent", log?.id, body);
}

/** Agent context: a call in the last 2 hours explains why we wrote first. */
export async function recentCallContext(businessId: string, phone: string): Promise<string | null> {
  const ev = await prisma.callEvent.findFirst({
    where: { businessId, phone: { in: phoneVariants(phone) }, direction: "in", at: { gte: new Date(Date.now() - 2 * 3_600_000) } },
    orderBy: { at: "desc" }, select: { at: true, outcome: true, case: true },
  });
  if (!ev) return null;
  const mins = Math.max(1, Math.round((Date.now() - ev.at.getTime()) / 60_000));
  const what = ev.outcome === "missed" ? "ולא ענינו לו" : "ודיברנו איתו בטלפון";
  const sent = ev.case && ev.case !== "none" ? " ושלחנו לו הודעה מיוזמתנו (היא מופיעה בשיחה)." : ".";
  return `הלקוח התקשר למספרה לפני ${mins} דק׳ ${what}${sent} אל תציג את עצמך שוב ואל תשאל "במה אפשר לעזור" — המשך מהנקודה: אם הוא בוחר שעה מההצעות, קבע; אם הוא מבקש שיחזרו אליו — הסלם לצוות.`;
}

export type CallRow = {
  id: string; at: string; phone: string; outcome: string; direction: string; durationSec: number;
  customerId: string | null; customerName: string | null; isNew: boolean; case: string | null; reason: string | null;
  conversationId: string | null; followUp: "none" | "replied" | "booked" | "called_back"; followUpText: string | null;
  upcoming: { date: string; startTime: string } | null;
};

/** The calls list for the admin screen: one Israel-calendar day, newest first, with what happened after each call. */
export async function listCalls(businessId: string, dateISO: string): Promise<CallRow[]> {
  const from = new Date(dateISO + "T00:00:00+03:00"), to = new Date(from.getTime() + DAY);
  const events = await prisma.callEvent.findMany({ where: { businessId, at: { gte: from, lt: to } }, orderBy: { at: "desc" } });
  if (!events.length) return [];
  const phones = Array.from(new Set(events.map(e => e.phone)));
  const variants = phones.flatMap(p => phoneVariants(p));
  const [customers, convs, outgoing] = await Promise.all([
    prisma.customer.findMany({ where: { businessId, deletedAt: null, phone: { in: variants } }, select: { id: true, name: true, phone: true } }),
    prisma.conversation.findMany({ where: { businessId, phone: { in: variants }, agentType: { not: "owner" } }, select: { id: true, phone: true, messages: { where: { role: "user" }, orderBy: { createdAt: "desc" }, take: 1, select: { content: true, createdAt: true } } } }),
    prisma.callEvent.findMany({ where: { businessId, direction: "out", at: { gte: from } }, select: { phone: true, at: true } }),
  ]);
  const custByPhone = new Map(customers.map(c => [normalizeIsraeliPhone(c.phone), c]));
  const convByPhone = new Map(convs.map(c => [normalizeIsraeliPhone(c.phone), c]));
  const custIds = customers.map(c => c.id);
  const [booked, upcomingAppts] = await Promise.all([
    custIds.length ? prisma.appointment.findMany({ where: { businessId, customerId: { in: custIds }, createdAt: { gte: from }, status: { in: ["pending", "confirmed", "completed"] } }, select: { customerId: true, createdAt: true, date: true, startTime: true } }) : [],
    custIds.length ? prisma.appointment.findMany({ where: { businessId, customerId: { in: custIds }, status: { in: ["pending", "confirmed"] }, date: { gte: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z") } }, orderBy: [{ date: "asc" }, { startTime: "asc" }], select: { customerId: true, date: true, startTime: true } }) : [],
  ]);
  return events.map(e => {
    const c = custByPhone.get(e.phone) ?? null;
    const conv = convByPhone.get(e.phone) ?? null;
    const reply = conv?.messages[0] && conv.messages[0].createdAt > e.at ? conv.messages[0] : null;
    const booking = c ? booked.find(b => b.customerId === c.id && b.createdAt > e.at) : null;
    const calledBack = outgoing.find(o => o.phone === e.phone && o.at > e.at && o.at.getTime() - e.at.getTime() < 3_600_000);
    const up = c ? upcomingAppts.find(a => a.customerId === c.id) : null;
    const followUp: CallRow["followUp"] = booking ? "booked" : reply ? "replied" : calledBack ? "called_back" : "none";
    return {
      id: e.id, at: e.at.toISOString(), phone: e.phone, outcome: e.outcome, direction: e.direction, durationSec: e.durationSec,
      customerId: c?.id ?? e.customerId, customerName: c?.name ?? null, isNew: !e.customerId, case: e.case, reason: e.reason,
      conversationId: conv?.id ?? null, followUp,
      followUpText: booking ? `נקבע תור ${booking.date.toISOString().slice(5, 10).split("-").reverse().join(".")} ${booking.startTime}` : reply ? reply.content.slice(0, 60) : calledBack ? `חזרנו אליו ${calledBack.at.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" })}` : null,
      upcoming: up ? { date: up.date.toISOString().slice(0, 10), startTime: up.startTime } : null,
    };
  });
}
