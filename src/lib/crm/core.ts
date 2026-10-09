/**
 * Chator CRM — the platform's own sales + customer-ops back office
 * (docs: Claude Docs "תוכנית‑העל", tabs "CRM ומכירות" and "סוכן המכירות", 9.10.2026).
 *
 * Settings, the sales reps and their call windows, free call slots, and the
 * lead pipeline stages. Everything here is platform-level (not per tenant):
 * only the super-admin reaches it (/admin/crm, /api/admin/crm/*).
 */
import { prisma } from "@/lib/prisma";
import { appointmentInstant, getBusinessNow, addDaysISO } from "@/lib/utils";
import { SUPER_ADMIN_PHONE } from "@/lib/super-admin";

// ─── Pipeline ────────────────────────────────────────────────────────────────

export const STAGES = [
  { key: "new", label: "ליד חדש" },
  { key: "chatting", label: "בשיחה עם הסוכן" },
  { key: "call_booked", label: "שיחה נקבעה" },
  { key: "trial", label: "בניסיון חינם" },
  { key: "paying", label: "משלם" },
  { key: "not_relevant", label: "לא רלוונטי" },
] as const;
export type Stage = (typeof STAGES)[number]["key"];
export const isStage = (s: unknown): s is Stage => typeof s === "string" && STAGES.some(x => x.key === s);
export const stageLabel = (s: string) => STAGES.find(x => x.key === s)?.label ?? s;

/** Legacy `status` the old super-admin tab reads, kept in step with the CRM stage. */
export function legacyStatusFor(stage: Stage): string {
  return stage === "trial" || stage === "paying" ? "won" : stage === "not_relevant" ? "lost" : stage === "new" ? "new" : "contacted";
}

// ─── Settings ────────────────────────────────────────────────────────────────

export const CRM_DEFAULTS = {
  callMinutes: 10,        // decided 9.10
  breakMinutes: 5,        // decided 9.10
  horizonDays: 7,         // how far ahead a lead can book
  minNoticeMinutes: 60,   // never offer a slot sooner than this
  infraCostIls: 150,      // servers + database per month, for the profitability card
  usdIls: 3.65,
};
export type CrmSettings = typeof CRM_DEFAULTS;

export async function getCrmSettings(): Promise<CrmSettings> {
  const rows = await prisma.crmSetting.findMany();
  const out = { ...CRM_DEFAULTS };
  for (const r of rows) {
    if (r.key in out) {
      const n = Number(r.value);
      if (Number.isFinite(n)) (out as Record<string, number>)[r.key] = n;
    }
  }
  return out;
}

export async function setCrmSettings(patch: Partial<CrmSettings>): Promise<CrmSettings> {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in CRM_DEFAULTS) || typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    await prisma.crmSetting.upsert({ where: { key: k }, create: { key: k, value: String(v) }, update: { value: String(v) } });
  }
  return getCrmSettings();
}

// ─── Seed (first visit) ──────────────────────────────────────────────────────

/** First time the CRM opens: Yair as the one rep (Sun–Thu 12:00–13:00) and the default automations, OFF.
 *  Idempotent and race-safe (deterministic ids + skipDuplicates; once per warm instance). */
let seeded: Promise<void> | null = null;
export function ensureCrmSeed(): Promise<void> {
  if (!seeded) seeded = runSeed().catch(e => { seeded = null; throw e; });
  return seeded;
}
async function runSeed(): Promise<void> {
  if ((await prisma.salesRep.count()) === 0) {
    await prisma.salesRep.createMany({ data: [{ id: "rep-owner", name: "יאיר", phone: SUPER_ADMIN_PHONE, isOwner: true }], skipDuplicates: true });
    await prisma.repWindow.createMany({ data: [0, 1, 2, 3, 4].map(d => ({ id: `win-owner-${d}`, repId: "rep-owner", dayOfWeek: d, startTime: "12:00", endTime: "13:00" })), skipDuplicates: true });
  }
  const { DEFAULT_AUTOMATIONS } = await import("@/lib/crm/automations");
  await prisma.crmAutomation.createMany({
    data: DEFAULT_AUTOMATIONS.map(a => ({ key: a.key, name: a.name, trigger: a.trigger, enabled: false, steps: JSON.stringify(a.steps), stopOn: JSON.stringify(a.stopOn), audience: a.audience })),
    skipDuplicates: true,
  });
}

// ─── Free call slots ─────────────────────────────────────────────────────────

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export type CallSlot = { repId: string; repName: string; startsAt: Date; dateISO: string; time: string };

/**
 * Open call slots across the active reps: each weekly window is cut into
 * (call + break) steps; booked calls, closed days, the past and the minimum
 * notice are removed. Sorted soonest first; when two reps share a time the
 * one with fewer calls that day comes first (keeps the load even).
 */
export async function freeCallSlots(opts: { repId?: string; limit?: number; fromISO?: string; days?: number } = {}): Promise<CallSlot[]> {
  const s = await getCrmSettings();
  const step = s.callMinutes + s.breakMinutes;
  const reps = await prisma.salesRep.findMany({ where: { active: true, ...(opts.repId ? { id: opts.repId } : {}) }, select: { id: true, name: true } });
  if (!reps.length) return [];
  const repIds = reps.map(r => r.id);
  const today = getBusinessNow().date;
  const from = opts.fromISO ?? today;
  const days = opts.days ?? s.horizonDays;
  const until = addDaysISO(from, days);
  // Availability is per specific date (10.10.2026: "כל שבוע הלו״ז משתנה") —
  // only what the rep opened for that date counts, never a weekly default.
  const [windows, offs, calls] = await Promise.all([
    prisma.repDateWindow.findMany({ where: { repId: { in: repIds }, date: { gte: new Date(from + "T00:00:00Z"), lt: new Date(until + "T00:00:00Z") } } }),
    prisma.repDayOff.findMany({ where: { repId: { in: repIds }, date: { gte: new Date(from + "T00:00:00Z"), lt: new Date(until + "T00:00:00Z") } } }),
    prisma.salesCall.findMany({ where: { repId: { in: repIds }, status: "booked", startsAt: { gte: appointmentInstant(new Date(from + "T00:00:00Z"), "00:00"), lt: appointmentInstant(new Date(until + "T00:00:00Z"), "00:00") } }, select: { repId: true, startsAt: true, durationMin: true } }),
  ]);
  const off = new Set(offs.map(o => `${o.repId}|${o.date.toISOString().slice(0, 10)}`));
  const earliest = Date.now() + s.minNoticeMinutes * 60_000;
  const out: (CallSlot & { load: number })[] = [];
  for (let i = 0; i < days; i++) {
    const dateISO = addDaysISO(from, i);
    const dayDate = new Date(dateISO + "T00:00:00Z");
    for (const rep of reps) {
      if (off.has(`${rep.id}|${dateISO}`)) continue;
      const dayCalls = calls.filter(c => c.repId === rep.id && israelDate(c.startsAt) === dateISO);
      for (const w of windows.filter(x => x.repId === rep.id && x.date.toISOString().slice(0, 10) === dateISO)) {
        for (let m = toMin(w.startTime); m + s.callMinutes <= toMin(w.endTime); m += step) {
          const startsAt = appointmentInstant(dayDate, toHHMM(m));
          if (startsAt.getTime() < earliest) continue;
          const t0 = startsAt.getTime(), t1 = t0 + step * 60_000;
          const clash = calls.some(c => c.repId === rep.id && c.startsAt.getTime() < t1 && c.startsAt.getTime() + (c.durationMin + s.breakMinutes) * 60_000 > t0);
          if (clash) continue;
          out.push({ repId: rep.id, repName: rep.name, startsAt, dateISO, time: toHHMM(m), load: dayCalls.length });
        }
      }
    }
  }
  out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.load - b.load);
  // One rep per time when several are free at the same minute.
  const seen = new Set<number>();
  const unique = out.filter(x => (seen.has(x.startsAt.getTime()) ? false : (seen.add(x.startsAt.getTime()), true)));
  return unique.slice(0, opts.limit ?? 50).map(x => ({ repId: x.repId, repName: x.repName, startsAt: x.startsAt, dateISO: x.dateISO, time: x.time }));
}

function israelDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** "היום ב-12:15" / "מחר ב-12:00" / "ביום שלישי 14.10 ב-12:30" — the way the agent and the messages say it. */
export function slotLabel(startsAt: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(startsAt);
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const iso = `${g("year")}-${g("month")}-${g("day")}`;
  const time = `${g("hour")}:${g("minute")}`;
  const today = getBusinessNow().date;
  if (iso === today) return `היום ב-${time}`;
  if (iso === addDaysISO(today, 1)) return `מחר ב-${time}`;
  const dow = new Date(iso + "T12:00:00Z").getUTCDay();
  return `ביום ${DAY_NAMES[dow]} ${Number(g("day"))}.${Number(g("month"))} ב-${time}`;
}

export { DAY_NAMES };
