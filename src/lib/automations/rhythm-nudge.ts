/**
 * "הגיע הזמן לתור" — rhythm nudge. Spec: specs/rhythm-nudge.md
 *
 * Once a day (10:00 Israel, never on Saturday) find customers whose own rhythm
 * says it is time for the next haircut and who have no appointment, and send
 * ONE friendly message with up to 3 real free times, asking what suits them.
 * Pure code — no model call. A free-text reply reaches the agent, which gets
 * the offer as context (customer-agent.ts loadCustomerContext).
 *
 * Idempotent: every send is a MessageLog (kind rhythm_nudge / rhythm_nudge_2)
 * keyed by phone, and a customer with a nudge in the last 21 days is skipped,
 * so a second run in the same window sends nothing.
 */
import { prisma } from "@/lib/prisma";
import { computeCustomerInsights, type CustomerInsights } from "@/lib/customer-insights";
import { computeQuickSlots } from "@/lib/quick-slots";
import { buildAvailabilityIndex, type AvailabilityIndex } from "@/lib/availability-index";
import { enqueueMessage, applyTemplate, firstName, staffDisplayName } from "@/lib/messaging";
import { getBusinessNow, addDaysISO, getDayOfWeekISO, timeToMinutes } from "@/lib/utils";
import { normalizeIsraeliPhone, phoneVariants } from "@/lib/messaging/phone";
import { recordNudgeOffer } from "@/lib/agent/booking-proposals";

// ── Settings (Business.settings.rhythmNudge) ─────────────────────────────────
export type RhythmSettings = {
  enabled: boolean;
  leadDays: number;          // send this many days before the target date
  earlyWindowDays: number;   // from this many days before, watch the target day filling up
  fillThreshold: number;     // ≤ this many free slots in the customer's window on the target day → send now
  secondNudge: boolean;      // one more message 5 days later if no reply/booking
  includeNewCustomers: boolean; // stage 2: one-visit customers after the shop's median rhythm
  excludedStaffIds: string[];   // customers regular with these barbers are skipped
  notBefore: string | null;     // YYYY-MM-DD — never send before this date (launch guard)
  newCustomerDays: number | null; // pace for one-visit customers; null = the shop's median rhythm
  quietAfterActivityDays: number; // skip anyone who no-showed / cancelled / wrote to us this recently
};
export const RHYTHM_DEFAULTS: RhythmSettings = {
  enabled: false, leadDays: 2, earlyWindowDays: 7, fillThreshold: 2, secondNudge: true,
  includeNewCustomers: false, excludedStaffIds: [], notBefore: null,
  newCustomerDays: null, quietAfterActivityDays: 3,
};
export function getRhythmSettings(raw: string | null | undefined): RhythmSettings {
  try {
    const s = raw ? JSON.parse(raw) : {};
    const r = (s.rhythmNudge && typeof s.rhythmNudge === "object") ? s.rhythmNudge : {};
    const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) && v >= 0 ? v : d);
    return {
      enabled: r.enabled === true,
      leadDays: num(r.leadDays, RHYTHM_DEFAULTS.leadDays),
      earlyWindowDays: num(r.earlyWindowDays, RHYTHM_DEFAULTS.earlyWindowDays),
      fillThreshold: num(r.fillThreshold, RHYTHM_DEFAULTS.fillThreshold),
      secondNudge: r.secondNudge !== false,
      includeNewCustomers: r.includeNewCustomers === true,
      excludedStaffIds: Array.isArray(r.excludedStaffIds) ? r.excludedStaffIds.filter((x: unknown) => typeof x === "string") : [],
      notBefore: typeof r.notBefore === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.notBefore) ? r.notBefore : null,
      newCustomerDays: typeof r.newCustomerDays === "number" && isFinite(r.newCustomerDays) && r.newCustomerDays >= 1 ? Math.round(r.newCustomerDays) : null,
      quietAfterActivityDays: num(r.quietAfterActivityDays, RHYTHM_DEFAULTS.quietAfterActivityDays),
    };
  } catch { return { ...RHYTHM_DEFAULTS }; }
}

import { DEFAULT_RHYTHM_TEMPLATE, DEFAULT_RHYTHM_SECOND_TEMPLATE, DEFAULT_RHYTHM_SECOND_TAKEN_TEMPLATE, DEFAULT_RHYTHM_NEW_TEMPLATE } from "@/lib/automations/rhythm-templates";
export { DEFAULT_RHYTHM_TEMPLATE, DEFAULT_RHYTHM_SECOND_TEMPLATE, DEFAULT_RHYTHM_SECOND_TAKEN_TEMPLATE, DEFAULT_RHYTHM_NEW_TEMPLATE };

// ── Types ────────────────────────────────────────────────────────────────────
export type Slot = { date: string; time: string; staffId: string; staffName: string; preferred: boolean };
export type PlanEntry = {
  customerId: string; name: string; phone: string;
  kind: "rhythm_nudge" | "rhythm_nudge_2" | "rhythm_nudge_new";
  variant: "regular" | "second" | "second_taken" | "new";
  reason: string;           // why today (for logs / dry run)
  daysToDue: number | null;
  staffMode: "regular" | "mixed";
  slots: Slot[];
  body: string;
  serviceId: string | null;
};
export type RunResult = { businessId: string; scanned: number; planned: PlanEntry[]; skipped: Record<string, number>; shopMedianDays?: number };

const HEB_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const NUDGE_KINDS = ["rhythm_nudge", "rhythm_nudge_2", "rhythm_nudge_new"];
const AUTOMATION_KINDS = ["reengage", "post_first_visit", "post_every_visit", "agent_followup", ...NUDGE_KINDS];
const DAY = 86_400_000;
const REGULAR_SHARE = 0.7;       // ≥70% of recent visits with one barber → "his barber"
const SECOND_AFTER_DAYS = 5;
const RELEASE_AFTER_DAYS = 42;   // 6 weeks past due → out until the next visit
const PAST_DUE_WINDOW = 30;      // first nudge still allowed up to 30 days past due

function todLabelWindow(tod: "morning" | "afternoon" | "evening" | null): (t: string) => boolean {
  if (!tod) return () => true;
  return (t: string) => { const h = timeToMinutes(t) / 60; return tod === "morning" ? h < 12 : tod === "afternoon" ? h >= 12 && h < 17 : h >= 17; };
}
/** "היום" / "מחר" / "יום שלישי ה-22.9" — in a message the date is always spelled out. */
export function dayLabel(iso: string, todayISO: string): string {
  const diff = Math.round((new Date(iso + "T00:00:00Z").getTime() - new Date(todayISO + "T00:00:00Z").getTime()) / DAY);
  if (diff === 0) return "היום";
  if (diff === 1) return "מחר";
  const d = new Date(iso + "T00:00:00Z");
  // "הבא" whenever that weekday comes round before the offered date — a customer
  // reading "יום חמישי" a week out otherwise plans for the wrong one.
  const next = diff >= 7 ? " *הבא*" : "";
  return `יום ${HEB_DAYS[getDayOfWeekISO(iso)]}${next} ה-${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}
/**
 * Options grouped by day, one line per day, so the message reads as a list:
 *   ביום שלישי ה-22.9 ב13:00 או ב13:30
 *   או ביום רביעי ה-23.9 ב16:00
 * (+ " אצל X" after each time when the offer mixes barbers.)
 */
export function formatOptions(slots: Slot[], todayISO: string, withStaff: boolean, teamNames: string[]): string {
  const name = (s: Slot) => staffDisplayName(s.staffName, teamNames);
  // Name the barber as few times as possible: once up front when every slot
  // is his, per day when each day is one barber's, per time only when mixed.
  const oneStaff = new Set(slots.map(s => s.staffId)).size === 1;
  const byDay = new Map<string, Slot[]>();
  for (const s of slots) byDay.set(s.date, [...(byDay.get(s.date) || []), s]);
  const lines = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, ds]) => {
    const label = dayLabel(date, todayISO);
    const day = label === "היום" || label === "מחר" ? label : `ב${label}`;
    const dayStaff = withStaff && !oneStaff && new Set(ds.map(s => s.staffId)).size === 1 ? ` אצל ${name(ds[0])}` : "";
    const perTime = withStaff && !oneStaff && !dayStaff;
    const times = ds.map(s => `ב${s.time}${perTime ? ` אצל ${name(s)}` : ""}`);
    return `${day}${dayStaff} ${times.join(" או ")}`;
  });
  const text = lines.map((l, i) => (i === 0 ? l : `או ${l}`)).join("\n");
  return withStaff && oneStaff ? `ל${name(slots[0])} ${text}` : text;
}

// ── Slot search ──────────────────────────────────────────────────────────────
/**
 * Up to 3 slots: 2 in the customer's time-of-day window + 1 "flowing", from
 * ≥2 days when possible. Search order: anchor day, then earlier days, then
 * later ones — earlier beats later (nobody wants to wait with long hair).
 * Availability = the same truth the website shows (customer-facing limits).
 */
async function findOffer(opts: {
  businessId: string; todayISO: string; anchorISO: string; staffId: string | null; serviceId: string | null;
  tod: "morning" | "afternoon" | "evening" | null; excludedStaffIds: string[]; blockedStaffIds: string[]; index: AvailabilityIndex;
}): Promise<Slot[]> {
  const inWindow = todLabelWindow(opts.tod);
  const order = opts.anchorISO > opts.todayISO
    ? [0, -1, -2, 1, 2, 3].map(d => addDaysISO(opts.anchorISO, d)).filter(d => d >= opts.todayISO)
    : [0, 1, 2, 3, 4, 5].map(d => addDaysISO(opts.todayISO, d));
  const seen = new Set<string>();
  const days = order.filter(d => (seen.has(d) ? false : (seen.add(d), true)));

  const preferred: Slot[] = [];
  const other: Slot[] = [];
  for (const date of days) {
    const rows = opts.staffId ? opts.index.staff.filter(s => s.id === opts.staffId) : opts.index.staffByLoad(date);
    for (const row of rows) {
      if (!opts.staffId && opts.excludedStaffIds.includes(row.id)) continue;
      if (opts.blockedStaffIds.includes(row.id)) continue;
      for (const t of opts.index.slots(row.id, date, opts.serviceId)) {
        const slot: Slot = { date, time: t, staffId: row.id, staffName: row.name, preferred: inWindow(t) };
        (slot.preferred ? preferred : other).push(slot);
      }
    }
    // Enough material? (2 preferred from ≥2 days, or plenty overall) → stop scanning.
    if (preferred.length >= 6 && new Set(preferred.map(p => p.date)).size >= 2) break;
    if (preferred.length + other.length >= 12 && days.indexOf(date) >= 2) break;
  }

  const pick: Slot[] = [];
  const takeFrom = (pool: Slot[], n: number) => {
    for (const s of pool) {
      if (pick.length >= n) return;
      // One option per (day, time) — "11:30 אצל יאיר או 11:30 אצל אוריה" reads like a bug.
      if (pick.some(p => p.date === s.date && p.time === s.time)) continue;
      // Prefer spreading over days: skip a same-day duplicate while another day is still available in the pool.
      const sameDay = pick.some(p => p.date === s.date);
      const otherDayExists = pool.some(q => q.date !== s.date && !pick.some(p => p.date === q.date && p.time === q.time));
      if (sameDay && otherDayExists && pick.length >= 1) continue;
      pick.push(s);
    }
  };
  takeFrom(preferred, 2);
  if (pick.length < 2) takeFrom(preferred, 2); // second pass allows same day
  // The "flowing" third: a different time-of-day or a different day.
  const flow = other.find(s => !pick.some(p => p.date === s.date && p.time === s.time)) ?? preferred.find(s => !pick.some(p => p.date === s.date && p.time === s.time));
  if (flow && pick.length < 3) pick.push(flow);
  if (pick.length < 3) { takeFrom(preferred, 3); takeFrom(other, 3); }
  if (pick.length) return pick.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).slice(0, 3);

  // Nothing in the window at all → nearest overall (customer's time-of-day first).
  const quick = await computeQuickSlots({ businessId: opts.businessId, staffIdFilter: opts.staffId, preferredServiceId: opts.serviceId, perBarber: 4, singleLimit: 12 });
  const q = quick.filter(s => !opts.excludedStaffIds.includes(s.staffId) || !!opts.staffId);
  const qp = q.filter(s => inWindow(s.time));
  return (qp.length >= 2 ? qp : q).slice(0, 3).map(s => ({ date: s.date, time: s.time, staffId: s.staffId, staffName: s.staffName, preferred: inWindow(s.time) }));
}

/** Free slots in the customer's window on one day, for the "filling up" rule. */
function freeInWindow(index: AvailabilityIndex, date: string, staffId: string | null, serviceId: string | null, tod: "morning" | "afternoon" | "evening" | null, excluded: string[]): number {
  const inWindow = todLabelWindow(tod);
  const rows = staffId ? index.staff.filter(s => s.id === staffId) : index.staffByLoad(date).filter(s => !excluded.includes(s.id));
  return rows.reduce((n, r) => n + index.slots(r.id, date, serviceId).filter(inWindow).length, 0);
}

// ── The run ──────────────────────────────────────────────────────────────────
export async function runRhythmNudge(now = new Date(), opts: { dryRun?: boolean; onlyCustomerIds?: string[]; businessId?: string; force?: boolean; /** tests: ignore due-date timing for the listed customers */ ignoreTiming?: boolean } = {}): Promise<RunResult[]> {
  const biz = await prisma.business.findMany({
    where: opts.businessId ? { id: opts.businessId } : {},
    select: { id: true, name: true, slug: true, settings: true, rhythmNudgeTemplate: true, rhythmNudgeSecondTemplate: true, rhythmNudgeSecondTakenTemplate: true, rhythmNudgeNewTemplate: true },
  });
  const results: RunResult[] = [];
  const { date: todayISO } = getBusinessNow();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";

  for (const b of biz) {
    const cfg = getRhythmSettings(b.settings);
    if (!cfg.enabled && !opts.force) continue;
    if (cfg.notBefore && todayISO < cfg.notBefore && !opts.force) continue;
    if (getDayOfWeekISO(todayISO) === 6 && !opts.force) continue; // Shabbat: no messages at all
    const res: RunResult = { businessId: b.id, scanned: 0, planned: [], skipped: {} };
    const skip = (why: string) => { res.skipped[why] = (res.skipped[why] || 0) + 1; };

    // One availability index for the whole run: today + 14 days covers every
    // offer window (anchor −2 … +5) and the "filling up" check.
    const index = await buildAvailabilityIndex(b.id, todayISO, 15);
    const customers = await prisma.customer.findMany({
      where: { businessId: b.id, deletedAt: null, isBlocked: false, messagingOptOut: false, phone: { not: "" }, ...(opts.onlyCustomerIds ? { id: { in: opts.onlyCustomerIds } } : {}) },
      select: {
        id: true, name: true, phone: true, knownBefore: true,
        staffBlocks: { select: { staffId: true } },
        appointments: { select: { date: true, startTime: true, endTime: true, status: true, staffId: true, serviceId: true, customServiceName: true, createdAt: true, staff: { select: { name: true, isAvailable: true } }, service: { select: { name: true } } } },
        waitlist: { where: { status: "waiting" }, select: { id: true }, take: 1 },
      },
    });
    res.scanned = customers.length;

    // Recent automation traffic (7 days) + this customer's nudges since their last visit.
    const since7 = new Date(now.getTime() - 7 * DAY);
    const recentAuto = await prisma.messageLog.findMany({ where: { businessId: b.id, kind: { in: AUTOMATION_KINDS }, createdAt: { gte: since7 }, status: { not: "failed" } }, select: { customerPhone: true } });
    // Customers who wrote to us in the last N days are mid-conversation — the agent has them; don't butt in.
    const quietSince = new Date(now.getTime() - cfg.quietAfterActivityDays * DAY);
    const recentInbound = cfg.quietAfterActivityDays > 0 ? await prisma.conversation.findMany({
      where: { businessId: b.id, agentType: { not: "owner" }, messages: { some: { role: "user", createdAt: { gte: quietSince } } } }, select: { phone: true },
    }) : [];
    const recentInboundPhones = new Set(recentInbound.map(c => normalizeIsraeliPhone(c.phone)));
    const quietSinceUTC = new Date(todayISO + "T00:00:00.000Z"); quietSinceUTC.setUTCDate(quietSinceUTC.getUTCDate() - cfg.quietAfterActivityDays);
    const recentAutoPhones = new Set(recentAuto.map(r => normalizeIsraeliPhone(r.customerPhone)));
    const nudgeLogs = await prisma.messageLog.findMany({ where: { businessId: b.id, kind: { in: NUDGE_KINDS }, createdAt: { gte: new Date(now.getTime() - 120 * DAY) }, status: { not: "failed" } }, select: { customerPhone: true, kind: true, createdAt: true, body: true } });
    const nudgesByPhone = new Map<string, { kind: string; createdAt: Date; body: string }[]>();
    for (const l of nudgeLogs) { const k = normalizeIsraeliPhone(l.customerPhone); nudgesByPhone.set(k, [...(nudgesByPhone.get(k) || []), l]); }

    // Shop-wide median rhythm (for one-visit customers, stage 2).
    let shopMedian = 21;
    const candidates: { c: (typeof customers)[number]; ins: CustomerInsights }[] = [];
    const intervals: number[] = [];
    for (const c of customers) {
      const ins = computeCustomerInsights(c.appointments, now);
      candidates.push({ c, ins });
      if (ins.avgIntervalDays && ins.visits >= 2) intervals.push(ins.avgIntervalDays);
    }
    if (intervals.length) { intervals.sort((a, b) => a - b); shopMedian = intervals[Math.floor(intervals.length / 2)]; }
    res.shopMedianDays = shopMedian;
    const todayUTC = new Date(todayISO + "T00:00:00.000Z");

    for (const { c, ins } of candidates) {
      const phone = normalizeIsraeliPhone(c.phone);
      if (!phone) { skip("no_phone"); continue; }
      if (c.appointments.some(a => a.date >= todayUTC && ["pending", "confirmed"].includes(a.status))) { skip("has_upcoming"); continue; }
      if (c.waitlist.length) { skip("on_waitlist"); continue; }
      if (ins.visits === 0) { skip("no_visits"); continue; }
      // Fresh no-show / cancellation / message: he's already in touch (or just flaked) — "ראיתי שלא קבעת" would land wrong.
      if (cfg.quietAfterActivityDays > 0 && (recentInboundPhones.has(phone) ||
          c.appointments.some(a => a.date >= quietSinceUTC && a.date < todayUTC && ["no_show", "cancelled_by_customer", "cancelled_by_staff"].includes(a.status)))) { skip("recent_activity"); continue; }

      // A "known before" regular with one visit here gets the regular message (paced by the shop median).
      const isNew = (ins.visits === 1 || !ins.avgIntervalDays) && !c.knownBefore;
      if (isNew && !cfg.includeNewCustomers) { skip("one_visit"); continue; }
      if (!ins.lastVisitAt) { skip("no_last_visit"); continue; }

      const interval = ins.avgIntervalDays || cfg.newCustomerDays || shopMedian;
      const dueISO = addDaysISO(ins.lastVisitAt, interval);
      const daysToDue = Math.round((new Date(dueISO + "T00:00:00Z").getTime() - todayUTC.getTime()) / DAY);
      if (daysToDue < -RELEASE_AFTER_DAYS) { skip("released_6w"); continue; }

      const lastVisitDate = new Date(ins.lastVisitAt + "T00:00:00Z");
      const myNudges = (nudgesByPhone.get(phone) || []).filter(n => n.createdAt > lastVisitDate).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      if (myNudges.length >= 2) { skip("two_nudges_done"); continue; }
      if (isNew && myNudges.length >= 1) { skip("new_once"); continue; }

      // Regular barber?
      const recentVisits = c.appointments
        .filter(a => !a.status.startsWith("cancelled") && a.status !== "no_show" && a.date < todayUTC)
        .sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 12);
      const byStaff = new Map<string, number>();
      for (const a of recentVisits) byStaff.set(a.staffId, (byStaff.get(a.staffId) || 0) + 1);
      const top = Array.from(byStaff.entries()).sort((a, b) => b[1] - a[1])[0];
      const topRow = top ? recentVisits.find(a => a.staffId === top[0]) : undefined;
      // "His barber" needs a pattern — at least 2 visits. One visit is not a
      // preference: a new customer gets options across the quick pool, with the
      // barber named per slot (spec §6), never a barber outside the pool.
      const regularStaffId = top && recentVisits.length >= 2 && !isNew && top[1] / recentVisits.length >= REGULAR_SHARE && topRow?.staff?.isAvailable ? top[0] : null;
      if (regularStaffId && cfg.excludedStaffIds.includes(regularStaffId)) { skip("staff_excluded"); continue; }
      const serviceId = ins.usual?.serviceId ?? null;
      const tod = ins.usual?.timeOfDay ?? null;

      // Which message, and is today the day?
      let kind: PlanEntry["kind"] = "rhythm_nudge";
      let variant: PlanEntry["variant"] = "regular";
      let reason = "";
      if (myNudges.length === 1) {
        if (!cfg.secondNudge) { skip("second_off"); continue; }
        const ageDays = (now.getTime() - myNudges[0].createdAt.getTime()) / DAY;
        if (ageDays < SECOND_AFTER_DAYS) { skip("waiting_for_second"); continue; }
        kind = "rhythm_nudge_2"; variant = "second"; reason = `second nudge, ${Math.floor(ageDays)}d after first`;
      } else {
        if (recentAutoPhones.has(phone)) { skip("automation_7d"); continue; }
        const anchor = daysToDue > 0 ? dueISO : todayISO;
        if (opts.ignoreTiming) {
          reason = `preview (due in ${daysToDue}d)`;
        } else if (daysToDue <= cfg.leadDays && daysToDue >= -PAST_DUE_WINDOW) {
          reason = daysToDue >= 0 ? `due in ${daysToDue}d (lead ${cfg.leadDays})` : `${-daysToDue}d past due`;
        } else if (daysToDue > cfg.leadDays && daysToDue <= cfg.earlyWindowDays) {
          const free = freeInWindow(index, anchor, regularStaffId, serviceId, tod, cfg.excludedStaffIds);
          if (free > cfg.fillThreshold) { skip("not_yet"); continue; }
          reason = `due in ${daysToDue}d but only ${free} free in window`;
        } else { skip(daysToDue > cfg.earlyWindowDays ? "not_yet" : "past_window"); continue; }
        // A customer who cancelled and never rebooked gets the SAME regular
        // message (owner's call) — the days in the offer simply differ.
        if (isNew) { variant = "new"; kind = "rhythm_nudge_new"; }
      }

      const anchorISO = daysToDue > 0 ? dueISO : todayISO;
      const blockedStaffIds = c.staffBlocks.map(x => x.staffId);
      if (regularStaffId && blockedStaffIds.includes(regularStaffId)) { skip("blocked_at_regular"); continue; }
      let slots = await findOffer({ businessId: b.id, todayISO, anchorISO, staffId: regularStaffId, serviceId, tod, excludedStaffIds: cfg.excludedStaffIds, blockedStaffIds, index });
      // New customer (one visit): one option with the barber he already met —
      // even outside the quick pool — plus two with others, so he sees a
      // familiar name AND the shop's breadth (owner's rule, 16.9).
      if (isNew && topRow?.staff?.isAvailable && top && !blockedStaffIds.includes(top[0]) && !cfg.excludedStaffIds.includes(top[0])) {
        const prevId = top[0];
        const withPrev = await findOffer({ businessId: b.id, todayISO, anchorISO, staffId: prevId, serviceId, tod, excludedStaffIds: cfg.excludedStaffIds, blockedStaffIds, index });
        const first = withPrev[0];
        if (first) {
          const others = slots.filter(s => s.staffId !== prevId && !(s.date === first.date && s.time === first.time)).slice(0, 2);
          slots = [first, ...others].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
        }
      }
      if (!slots.length) { skip("no_slots"); continue; }

      // Second nudge: are the times we offered the first time still on the
      // table? If none of the new offer's (day,time) pairs appeared in the first
      // message, say so instead of "עדיין פנוי".
      if (variant === "second") {
        const firstBody = myNudges[0]?.body ?? "";
        // Weekday name + time — tolerant to the label format the first message used.
        const stillOffered = slots.some(s => firstBody.includes(s.time) && firstBody.includes(HEB_DAYS[getDayOfWeekISO(s.date)]));
        if (!stillOffered) variant = "second_taken";
      }
      const mixed = !regularStaffId;
      const staffName = regularStaffId ? (slots[0]?.staffName || topRow?.staff?.name || "") : "";
      const teamNames = index.staff.map(s => s.name);
      const vars = {
        name: firstName(c.name),
        staff: staffDisplayName(staffName, teamNames),
        at_staff: mixed ? "לנו " : `ל${staffDisplayName(staffName, teamNames)} `,
        options: formatOptions(slots, todayISO, mixed || variant === "new", teamNames),
        booking_link: `${baseUrl}${b.slug ? `/${b.slug}` : ""}/book`,
      };
      const tmpl = variant === "second" ? (b.rhythmNudgeSecondTemplate || DEFAULT_RHYTHM_SECOND_TEMPLATE)
        : variant === "second_taken" ? (b.rhythmNudgeSecondTakenTemplate || DEFAULT_RHYTHM_SECOND_TAKEN_TEMPLATE)
        : variant === "new" ? (b.rhythmNudgeNewTemplate || DEFAULT_RHYTHM_NEW_TEMPLATE)
        : (b.rhythmNudgeTemplate || DEFAULT_RHYTHM_TEMPLATE);
      const body = applyTemplate(tmpl, vars);

      res.planned.push({ customerId: c.id, name: c.name, phone, kind, variant, reason, daysToDue, staffMode: mixed ? "mixed" : "regular", slots, body, serviceId });
    }

    // Most overdue first, then send.
    res.planned.sort((a, b) => (a.daysToDue ?? 0) - (b.daysToDue ?? 0));
    if (!opts.dryRun) {
      for (const p of res.planned) {
        // The chat mirror happens in the drip queue at the moment of delivery,
        // so the thread shows the real send time (1/min), not the plan time.
        await enqueueMessage({ businessId: b.id, customerPhone: p.phone, kind: p.kind, body: p.body, scheduledFor: now });
        // Stage C: remember the offer structured, so a reply that picks one of
        // these slots is handled in code (booking-proposals.ts), no model call.
        await recordNudgeOffer({ businessId: b.id, phone: p.phone, serviceId: p.serviceId, options: p.slots.map(s => ({ staffId: s.staffId, staffName: s.staffName, date: s.date, startTime: s.time })) }).catch(e => console.error("[rhythm-nudge] offer record failed", e));
      }
    }
    results.push(res);
  }
  return results;
}

/** For the agent: what we offered this customer in the last 5 days (if anything). */
export async function recentNudgeContext(businessId: string, phone: string): Promise<string | null> {
  const log = await prisma.messageLog.findFirst({
    where: { businessId, customerPhone: { in: phoneVariants(phone) }, kind: { in: NUDGE_KINDS }, createdAt: { gte: new Date(Date.now() - 5 * DAY) }, status: { not: "failed" } },
    orderBy: { createdAt: "desc" }, select: { body: true, createdAt: true },
  });
  if (!log) return null;
  const when = log.createdAt.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
  return `לאחרונה (${when}) שלחנו לו מיוזמתנו הצעה לתור, כי לפי הקצב שלו הגיע הזמן: "${log.body.replace(/\s+/g, " ").slice(0, 220)}". אם הוא עונה עכשיו ובוחר אחת מהשעות — זה מה שהוא רוצה, קבע לו אותה מיד (בדוק זמינות עם הכלי; אם נתפסה — הצע את הקרובה ביותר באותו יום ובאותו טווח שעות). אל תשאל אותו שוב איזה שירות או איזה ספר — זה כבר ידוע.`;
}
