/**
 * The WhatsApp funnel (25.10.2026, Yair: "המטרה לא לזרוק אף שיחת וואטסאפ שנפתחה").
 *
 * Whoever writes to Chator's number (or its Instagram) and is not a lead yet sits in
 * its own CRM tab ("וואטסאפ"), by stage, and gets that stage's follow-ups when he goes
 * quiet. He leaves the funnel as a real lead (asked for a person, details or a call,
 * or gave his name for a call), as a customer (signed up), or as not relevant (said no,
 * or N days without an answer after the stage's messages; a new message brings him back).
 * The messages, their timing and the rules are Yair's to edit (CRM › הגדרות › משפך וואטסאפ).
 *
 * Pure: stage and timing rules, the settings and their defaults. The cron engine and the
 * CRM view are in src/lib/agent/wa-funnel-run.ts.
 */
import type { SalesState } from "@/lib/agent/sales-agent";
import { getCrmText, setCrmText } from "@/lib/crm/core";
import { appointmentInstant, addDaysISO } from "@/lib/utils";

export const WA_STAGES = ["opened", "tried", "booked", "signup_link"] as const;
export type WaStage = (typeof WA_STAGES)[number];
export const WA_STAGE_LABEL: Record<WaStage, string> = {
  opened: "פתח שיחה",
  tried: "ניסה את הדמו",
  booked: "קבע תור בדמו",
  signup_link: "קיבל קישור הרשמה",
};
export type WaExit = "lead" | "signed_up" | "not_relevant" | "opted_out";
export const WA_EXIT_LABEL: Record<WaExit, string> = { lead: "ליד אמיתי", signed_up: "נרשם", not_relevant: "לא רלוונטי", opted_out: "הוסר" };

/** The funnel's own record inside the chat's salesState. */
export type WaTrack = {
  stage?: WaStage;
  at?: string;                     // when he reached the stage
  sent?: Record<string, string>;   // "<stage>:<step id>" → when it went out (never twice)
  out?: "lead" | "not_relevant" | "opted_out";
  outAt?: string;
  outBy?: "manual" | "keyword" | "agent";
};

export type FunnelUnit = "minutes" | "hours" | "days";
/** One follow-up: after `wait` of silence; in days it goes out at `at` o'clock that day. */
export type FunnelStep = { id: string; wait: number; unit: FunnelUnit; at?: number; text: string; on: boolean };
export type FunnelHours = { weekdayFrom: number; weekdayTo: number; fridayTo: number };
export type FunnelConfig = {
  enabled: boolean;
  /** Chats that went quiet before the funnel was switched on are left alone (no burst of old follow-ups). */
  enabledAt: string | null;
  notRelevantDays: number;
  repLine: string;
  repLineFirstReply: boolean;
  repLineFollowups: boolean;
  /** The answer to "נציג". */
  repReply: string;
  hours: FunnelHours;
  stages: Record<WaStage, FunnelStep[]>;
};

export const FUNNEL_VARIABLES = ["{שם}", "{דף נחיתה}", "{קישור הרשמה}", "{שעה פנויה}", "{נציג}"] as const;

export const DEFAULT_FUNNEL: FunnelConfig = {
  enabled: false,
  enabledAt: null,
  notRelevantDays: 3,
  repLine: "רוצה לדבר עם בן אדם? תכתוב נציג ויאיר יחזור אליך.",
  repLineFirstReply: true,
  repLineFollowups: true,
  repReply: "בשמחה. {נציג} ישמח לדבר איתך, שיחה קצרה של כמה דקות. {שעות לשיחה}",
  hours: { weekdayFrom: 9, weekdayTo: 21, fridayTo: 14 },
  stages: {
    opened: [
      { id: "o1", wait: 3, unit: "hours", on: true, text: "נעצרנו באמצע 🙂 יש משהו שלא ברור? אפשר לשאול אותי כאן, או לכתוב נציג ויאיר יחזור אליך" },
      { id: "o2", wait: 1, unit: "days", at: 10, on: true, text: "אם נוח לך לראות הכל במקום אחד, זה העמוד שלנו: {דף נחיתה}" },
      { id: "o3", wait: 3, unit: "days", at: 10, on: true, text: "ואם בא לך פשוט לנסות על העסק שלך, החודש הראשון עלינו: {קישור הרשמה}" },
    ],
    tried: [
      { id: "t1", wait: 2, unit: "hours", on: true, text: "נו, יש לי מקום {שעה פנויה} 😄 לשריין לך?" },
      { id: "t2", wait: 1, unit: "days", at: 10, on: true, text: "עדיין רוצה לנסות? תכתוב לי שעה ואני קובע." },
    ],
    booked: [
      { id: "b1", wait: 3, unit: "hours", on: true, text: "ככה זה נראה אצל מספרות שכבר עובדות איתנו: {דף נחיתה}\nיש שאלה? אני כאן, או לכתוב נציג" },
      { id: "b2", wait: 1, unit: "days", at: 10, on: true, text: "רוצה לנסות על העסק שלך? החודש הראשון עלינו: {קישור הרשמה}" },
    ],
    signup_link: [
      { id: "l1", wait: 3, unit: "hours", on: true, text: "נתקעת בהרשמה? אפשר לשאול אותי כאן, או לכתוב נציג ויאיר יעשה את זה איתך" },
      { id: "l2", wait: 1, unit: "days", at: 10, on: true, text: "כל הפרטים במקום אחד: {דף נחיתה}" },
    ],
  },
};

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** Whatever was stored, as a full valid config (missing parts take the defaults). */
export function normalizeFunnel(raw: unknown): FunnelConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<FunnelConfig>;
  const d = DEFAULT_FUNNEL;
  const str = (v: unknown, dflt: string) => (typeof v === "string" ? v.slice(0, 1000) : dflt);
  const stages = {} as Record<WaStage, FunnelStep[]>;
  for (const s of WA_STAGES) {
    const list = Array.isArray(r.stages?.[s]) ? r.stages![s] : d.stages[s];
    stages[s] = list.slice(0, 8).map((x, i) => {
      const unit: FunnelUnit = x?.unit === "minutes" || x?.unit === "days" ? x.unit : "hours";
      return {
        id: typeof x?.id === "string" && x.id ? x.id.slice(0, 20) : `${s[0]}${i + 1}${Date.now() % 1000}`,
        wait: clampInt(x?.wait, unit === "minutes" ? 5 : 1, unit === "days" ? 14 : unit === "hours" ? 72 : 600, 1),
        unit,
        ...(unit === "days" ? { at: clampInt(x?.at, 0, 23, 10) } : {}),
        text: str(x?.text, "").trim(),
        on: x?.on !== false,
      };
    });
  }
  const h = (r.hours ?? {}) as Partial<FunnelHours>;
  return {
    enabled: r.enabled === true,
    enabledAt: typeof r.enabledAt === "string" ? r.enabledAt : null,
    notRelevantDays: clampInt(r.notRelevantDays, 1, 30, d.notRelevantDays),
    repLine: str(r.repLine, d.repLine).trim(),
    repLineFirstReply: r.repLineFirstReply !== false,
    repLineFollowups: r.repLineFollowups !== false,
    repReply: str(r.repReply, d.repReply).trim() || d.repReply,
    hours: { weekdayFrom: clampInt(h.weekdayFrom, 0, 23, 9), weekdayTo: clampInt(h.weekdayTo, 1, 24, 21), fridayTo: clampInt(h.fridayTo, 0, 24, 14) },
    stages,
  };
}

export async function getFunnelConfig(): Promise<FunnelConfig> {
  const t = (await getCrmText("waFunnel").catch(() => ({ text: "" }))).text;
  if (!t) return normalizeFunnel(null);
  try { return normalizeFunnel(JSON.parse(t)); } catch { return normalizeFunnel(null); }
}

/** Saves; switching it on stamps enabledAt, so only chats that go quiet from now on get follow-ups. */
export async function saveFunnelConfig(next: unknown): Promise<FunnelConfig> {
  const prev = await getFunnelConfig();
  const cfg = normalizeFunnel(next);
  cfg.enabledAt = cfg.enabled ? (prev.enabled && prev.enabledAt ? prev.enabledAt : new Date().toISOString()) : prev.enabledAt;
  await setCrmText("waFunnel", JSON.stringify(cfg));
  return cfg;
}

// ─── Stage ───────────────────────────────────────────────────────────────────

const ORDER: Record<WaStage, number> = { opened: 0, tried: 1, booked: 2, signup_link: 3 };

/** Where the chat is now, from the sales agent's state alone. */
export function rawStage(s: SalesState): WaStage {
  if (s.signupLinkAt) return "signup_link";
  if (s.afterDemoAt) return "booked";
  if (s.mode === "demo" || s.mode === "lead_demo") return "tried";
  return "opened";
}

/** The state with its funnel stage moved forward (never back: whoever tried the demo stays "tried"). */
export function withWaTrack(s: SalesState, now = new Date()): SalesState {
  const prev = s.wa ?? {};
  const raw = rawStage(s);
  if (prev.stage && ORDER[prev.stage] >= ORDER[raw]) return s;
  return { ...s, wa: { ...prev, stage: raw, at: now.toISOString() } };
}

/** The saved track and this turn's copy of it: the further stage, every follow-up sent; the turn's exit wins. */
export function mergeWa(db: WaTrack, mine: WaTrack | undefined): WaTrack {
  const m = mine ?? {};
  const further = !m.stage || (db.stage && ORDER[db.stage] > ORDER[m.stage]) ? { stage: db.stage, at: db.at } : { stage: m.stage, at: m.at };
  return { ...db, ...m, ...further, sent: { ...db.sent, ...m.sent } };
}

export const stageOf = (s: SalesState): WaStage => {
  const raw = rawStage(s);
  return s.wa?.stage && ORDER[s.wa.stage] > ORDER[raw] ? s.wa.stage : raw;
};

// ─── Time ────────────────────────────────────────────────────────────────────

const IL_PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
export function israelClock(d: Date): { day: string; weekday: number; hour: number } {
  const p = Object.fromEntries(IL_PARTS.formatToParts(d).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(p.weekday)), hour: Number(p.hour) % 24 };
}

/** Inside the sending hours (never on Saturday). */
export function okHours(d: Date, h: FunnelHours): boolean {
  const c = israelClock(d);
  if (c.weekday === 6) return false;
  if (c.weekday === 5) return c.hour >= h.weekdayFrom && c.hour < h.fridayTo;
  return c.hour >= h.weekdayFrom && c.hour < h.weekdayTo;
}

/** The first moment from `d` that is inside the sending hours (whole hours). */
export function nextAllowed(d: Date, h: FunnelHours): Date {
  if (okHours(d, h)) return d;
  let t = new Date(Math.floor(d.getTime() / 3600_000) * 3600_000 + 3600_000);
  for (let i = 0; i < 24 * 8 && !okHours(t, h); i++) t = new Date(t.getTime() + 3600_000);
  return t;
}

/** When a step is due after a silence that started at `anchor`. */
export function stepDueAt(step: FunnelStep, anchor: Date): Date {
  if (step.unit === "minutes") return new Date(anchor.getTime() + step.wait * 60_000);
  if (step.unit === "hours") return new Date(anchor.getTime() + step.wait * 3600_000);
  const day = addDaysISO(israelClock(anchor).day, step.wait);
  return appointmentInstant(new Date(`${day}T00:00:00Z`), `${String(step.at ?? 10).padStart(2, "0")}:00`);
}

/** Instagram only lets us write within 24 hours of his last message. */
const IG_WINDOW_MS = 23 * 3600_000;
/** Two follow-ups never go out less than an hour apart (after Shabbat, say). */
const MIN_GAP_MS = 3600_000;
/** A follow-up more than LATE_MS late is skipped when the next step is due within SOON_MS (27.10.2026). */
const LATE_MS = 3600_000;
const SOON_MS = 6 * 3600_000;

/** What we know about one chat, from the database. */
export type ContactFacts = {
  state: SalesState;
  ig: boolean;
  lastUserAt: Date | null;
  lastOurAt: Date | null;
  lastIsOurs: boolean;
  isLead: boolean;
  optedOut: boolean;
  signedUp: boolean;
  escalated: boolean;
  /** Asked about a course (the academy shares the number): no follow-ups. */
  academy?: boolean;
  /** How many messages he wrote: two or more = he talked with the agent, one follow-up only. */
  userTurns?: number;
};
export type ContactPlan = {
  stage: WaStage;
  exit: WaExit | null;
  /** skip: earlier steps that were overdue together with this one; marked sent with it, never sent. */
  next: { key: string; step: FunnelStep; sendAt: Date; skip?: string[] } | null;
  /** No more steps: when he turns "not relevant" if he stays quiet. */
  notRelevantAt: Date | null;
};

export function planContact(f: ContactFacts, cfg: FunnelConfig, now = new Date()): ContactPlan {
  const s = f.state;
  const stage = stageOf(s);
  const t = s.wa ?? {};
  const base = { stage, next: null, notRelevantAt: null };
  if (f.optedOut || t.out === "opted_out") return { ...base, exit: "opted_out" };
  if (f.signedUp) return { ...base, exit: "signed_up" };
  if (f.isLead || t.out === "lead" || s.leadId || s.mode === "lead" || s.mode === "lead_demo" || s.mode === "choosing") return { ...base, exit: "lead" };
  // "לא רלוונטי" by hand holds until he writes again.
  if (t.out === "not_relevant" && (!f.lastUserAt || !t.outAt || f.lastUserAt.getTime() <= new Date(t.outAt).getTime())) return { ...base, exit: "not_relevant" };
  if (s.mode === "declined") return { ...base, exit: "not_relevant" };

  let next: ContactPlan["next"] = null;
  const anchor = f.lastUserAt;
  if (anchor && f.lastIsOurs && !f.escalated && !f.academy && (!cfg.enabledAt || anchor.getTime() >= new Date(cfg.enabledAt).getTime())) {
    const lastSent = Math.max(0, ...Object.values(t.sent ?? {}).map(x => new Date(x).getTime()).filter(Number.isFinite));
    // Several steps overdue together (the follow-ups were down, the steps changed, the night, Shabbat):
    // only the latest of them goes out and the earlier ones are skipped; and one more than LATE_MS late
    // waits for the next step instead when that one is due within SOON_MS. Before 27.10.2026 they went out
    // one by one, an hour apart: three follow-ups in a row the morning the new server came up.
    // He already talked with the agent (two messages or more): one follow-up only, the stage's last (the
    // next day's); the earlier ones are skipped (Yair, 28.10.2026: "מפסיקים לחפור לו", "הודעת המשך אחת בלבד").
    const live = cfg.stages[stage].filter(st => st.on && st.text.trim());
    const talked = (f.userTurns ?? 0) >= 2 && live.length > 1;
    const skip: string[] = talked ? live.slice(0, -1).map(st => `${stage}:${st.id}`).filter(k => !t.sent?.[k]) : [];
    let nextDue = 0;
    for (const step of talked ? live.slice(-1) : cfg.stages[stage]) {
      const key = `${stage}:${step.id}`;
      if (!step.on || !step.text.trim() || t.sent?.[key]) continue;
      const due = stepDueAt(step, anchor);
      if (f.ig && due.getTime() - anchor.getTime() > IG_WINDOW_MS) continue;
      const at = nextAllowed(new Date(Math.max(due.getTime(), lastSent ? lastSent + MIN_GAP_MS : 0)), cfg.hours);
      if (f.ig && at.getTime() - anchor.getTime() > IG_WINDOW_MS) continue;
      const overdue = due.getTime() <= now.getTime();
      if (next) {
        const late = now.getTime() - nextDue > LATE_MS;
        if (!overdue && (!late || due.getTime() - now.getTime() > SOON_MS)) break;
        skip.push(next.key);
      }
      next = { key, step, sendAt: at, skip: [...skip] };
      nextDue = due.getTime();
      if (!overdue) break;
    }
  }
  // Quiet N days after our last message, with nothing more to send → not relevant.
  const notRelevantAt = !next && f.lastIsOurs && f.lastOurAt ? new Date(f.lastOurAt.getTime() + cfg.notRelevantDays * 86_400_000) : null;
  if (notRelevantAt && now >= notRelevantAt) return { stage, exit: "not_relevant", next: null, notRelevantAt };
  return { stage, exit: null, next, notRelevantAt };
}

/** The variables of a follow-up. A missing name just drops out ("היי {שם}," → "היי,"). */
export function fillFunnelText(text: string, v: { name?: string | null; landing: string; signup: string; slot?: string | null; rep: string; callSlots?: string }): string {
  return text
    .replace(/ ?\{שם\}/g, v.name ? ` ${v.name}` : "")
    .replace(/\{דף נחיתה\}/g, v.landing)
    .replace(/\{קישור הרשמה\}/g, v.signup)
    .replace(/\{שעה פנויה\}/g, v.slot || "מחר")
    .replace(/\{נציג\}/g, v.rep)
    .replace(/\{שעות לשיחה\}/g, v.callSlots ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** "בעוד שעתיים" style label for when the next step goes out, Israel time. */
export function whenLabel(d: Date, now = new Date()): string {
  const time = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const today = israelClock(now).day;
  const day = israelClock(d).day;
  if (d.getTime() <= now.getTime() + 5 * 60_000) return "בדקות הקרובות";
  if (day === today) return `היום ב-${time}`;
  if (day === addDaysISO(today, 1)) return `מחר ב-${time}`;
  const dm = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" }).format(d);
  return `ב-${dm} ב-${time}`;
}

/** He asks for a person: "נציג", "בן אדם". */
export const WANTS_REP_RE = /(^|[\s,.!?])(נציג|נציגה|לנציג|לנציגה)($|[\s,.!?])|^(לדבר עם |רוצה |אפשר )?(בן אדם|אדם אמיתי)[\s!.?]*$/;
/** He asks for details or a call: a real lead (Yair: "אם הוא כתב תן לי פרטים... הוא הופך להיות ליד"). */
export const WANTS_DETAILS_RE = /(תן|תני|תנו|שלח|שלחו|תשלח|תשלחו|אפשר|אשמח ל?|רוצה)\s*(לי\s+)?(עוד\s+)?פרטים|פרטים נוספים|תתקשר|תתקשרו|שיתקשרו|תחזור אלי|תחזרו אלי|שיחזרו אלי|לקבוע שיחה|רוצה שיחה|לדבר עם יאיר|לדבר עם מישהו/;
