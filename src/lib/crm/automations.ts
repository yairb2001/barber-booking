/**
 * CRM automations: a trigger starts a run; each step waits, then queues one
 * WhatsApp message from Chator's number (the demo shop's line). Messages go
 * through the drip queue, so quiet hours (21:30–08:00), Shabbat and the safe
 * sending pace apply for free, and a sent message is mirrored into the lead's
 * chat thread (kind "crm_message").
 *
 * Every text, delay and on/off switch is edited from /admin/crm/automations.
 * The defaults below are seeded OFF — Yair turns each on after reading it.
 *
 * Step timing: `delayMinutes` counts from the previous step (the first from
 * the trigger); `beforeCallMinutes` counts back from the booked call (a step
 * whose moment already passed is skipped, never sent late).
 */
import { prisma } from "@/lib/prisma";
import { enqueueMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { freeCallSlots, slotLabel } from "@/lib/crm/core";
import { onboardingLinkFor } from "@/lib/leads";
import { signOnboardingToken } from "@/lib/auth";

export type AutoStep = { delayMinutes?: number; beforeCallMinutes?: number; text: string };
export type StopReason = "replied" | "call_booked" | "opted_out" | "not_relevant" | "call_cancelled" | "onboarding_done" | "paid";
export type AutomationKey = "lead_new" | "call_booked" | "call_no_answer" | "call_won" | "followup" | "trial_ending" | "churn_risk" | "setup_stuck" | "setup_stuck_rep";

export const STOP_LABELS: Record<StopReason, string> = {
  replied: "הליד ענה",
  call_booked: "נקבעה שיחה",
  opted_out: "ביקש להסיר",
  not_relevant: "סומן לא רלוונטי",
  call_cancelled: "השיחה בוטלה",
  onboarding_done: "סיים את ההקמה",
  paid: "עבר לתשלום",
};

export const VARIABLES = ["{שם}", "{שם העסק}", "{שעת השיחה}", "{שם הנציג}", "{שעה פנויה ראשונה}", "{שעה פנויה שנייה}", "{קישור הקמה}", "{השלב שנתקע}"];

const DAY = 24 * 60;

/** Seeded once, OFF. Texts are first drafts in Yair's voice: short, no dashes, no catchphrases. */
export const DEFAULT_AUTOMATIONS: { key: AutomationKey; name: string; trigger: string; audience: "lead" | "rep"; stopOn: StopReason[]; steps: AutoStep[] }[] = [
  {
    key: "lead_new", name: "ליד חדש מהאתר", trigger: "מילא טופס באתר", audience: "lead",
    stopOn: ["replied", "call_booked", "opted_out", "not_relevant"],
    steps: [
      { delayMinutes: 0, text: "היי {שם}, כאן צ'אטור. ראיתי שהשארת פרטים באתר. רוצה לקבוע שיחה של 10 דקות עם {שם הנציג} ולראות איך זה יעבוד אצלך? יש לי {שעה פנויה ראשונה} או {שעה פנויה שנייה}. אפשר גם לנסות בעצמך לקבוע תור במספרת ההדגמה, פשוט תכתוב \"דמו\". להסרה השב \"הסר\"." },
      { delayMinutes: DAY, text: "היי {שם}, רק מוודא שראית. יש לי {שעה פנויה ראשונה} או {שעה פנויה שנייה}, מה נוח לך?" },
      { delayMinutes: 3 * DAY, text: "לא אציק יותר. אם תרצה לראות את הסוכן בפעולה, תכתוב כאן \"דמו\" ותנסה לקבוע תור כמו לקוח." },
    ],
  },
  {
    key: "call_booked", name: "תזכורות לשיחה", trigger: "נקבעה שיחה", audience: "lead",
    stopOn: ["call_cancelled", "opted_out", "not_relevant"],
    steps: [
      { beforeCallMinutes: 180, text: "היי {שם}, תזכורת: {שעת השיחה} {שם הנציג} מתקשר אליך לשיחה של 10 דקות. לא מתאים? תכתוב לי ונזיז." },
      { beforeCallMinutes: 15, text: "{שם הנציג} מתקשר אליך בעוד רבע שעה." },
    ],
  },
  {
    key: "call_no_answer", name: "פספסנו את השיחה", trigger: "הנציג סימן \"לא ענה\"", audience: "lead",
    stopOn: ["replied", "call_booked", "opted_out", "not_relevant"],
    steps: [
      { delayMinutes: 0, text: "היי {שם}, ניסינו לתפוס אותך ולא הצלחנו. נקבע שעה אחרת? יש לי {שעה פנויה ראשונה} או {שעה פנויה שנייה}." },
    ],
  },
  {
    key: "call_won", name: "נסגר: עזרה בהקמה", trigger: "הנציג סימן \"נסגר\" (קישור ההקמה יוצא מיד, אוטומטית)", audience: "lead",
    stopOn: ["onboarding_done", "opted_out"],
    steps: [
      { delayMinutes: DAY, text: "היי {שם}, ראיתי שעוד לא סיימת את ההקמה. משהו נתקע? הנה הקישור שוב: {קישור הקמה}" },
    ],
  },
  {
    key: "followup", name: "לחזור אליו", trigger: "בתאריך שהנציג בחר", audience: "lead",
    stopOn: ["replied", "call_booked", "opted_out", "not_relevant"],
    steps: [
      { delayMinutes: 0, text: "היי {שם}, חוזר אליך מצ'אטור כמו שסיכמנו. מתי נוח לך לשיחה קצרה? יש לי {שעה פנויה ראשונה} או {שעה פנויה שנייה}." },
    ],
  },
  {
    key: "trial_ending", name: "הניסיון מסתיים", trigger: "5 ימים לפני סוף החודש החינמי", audience: "lead",
    stopOn: ["paid", "opted_out"],
    steps: [
      { delayMinutes: 0, text: "היי {שם}, החודש החינמי של {שם העסק} בצ'אטור מסתיים בעוד 5 ימים. רוצה שנמשיך? {שם הנציג} ישמח לעבור איתך על זה בשיחה קצרה." },
    ],
  },
  {
    key: "setup_stuck", name: "הקמה תקועה: עזרה לבעל העסק", trigger: "24 שעות בלי התקדמות בהקמה", audience: "lead",
    stopOn: ["onboarding_done", "opted_out"],
    steps: [
      { delayMinutes: 0, text: "היי {שם}, ראיתי שעצרת בשלב \"{השלב שנתקע}\" בהקמה של {שם העסק}. משהו לא ברור? אפשר לענות לי כאן ונעזור, או להמשיך מהקישור: {קישור הקמה}" },
    ],
  },
  {
    key: "setup_stuck_rep", name: "הקמה תקועה: התראה לנציג", trigger: "48 שעות בלי התקדמות בהקמה", audience: "rep",
    stopOn: [],
    steps: [
      { delayMinutes: 0, text: "הקמה תקועה יומיים: {שם העסק} עצר ב\"{השלב שנתקע}\". שווה להתקשר." },
    ],
  },
  {
    key: "churn_risk", name: "סיכון עזיבה", trigger: "עסק בלי תורים 7 ימים", audience: "rep",
    stopOn: [],
    steps: [
      { delayMinutes: 0, text: "סיכון עזיבה: {שם העסק} בלי תורים כבר 7 ימים. שווה להתקשר." },
    ],
  },
];

export function parseSteps(raw: string): AutoStep[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(s => s && typeof s.text === "string").map(s => ({
      text: String(s.text).slice(0, 1500),
      ...(Number.isFinite(s.beforeCallMinutes) ? { beforeCallMinutes: Math.max(0, Math.round(s.beforeCallMinutes)) } : { delayMinutes: Math.max(0, Math.round(Number(s.delayMinutes) || 0)) }),
    })) : [];
  } catch { return []; }
}
export function parseStopOn(raw: string): StopReason[] {
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x): x is StopReason => typeof x === "string" && x in STOP_LABELS) : []; } catch { return []; }
}

type RunContext = { callId?: string; stepLabel?: string };

/** Start (or restart) an automation for a lead / business. Silently does nothing when it is OFF. */
export async function startAutomation(key: AutomationKey, target: { leadId?: string; businessId?: string; context?: RunContext }): Promise<void> {
  try {
    const a = await prisma.crmAutomation.findUnique({ where: { key } });
    if (!a || !a.enabled) return;
    const steps = parseSteps(a.steps);
    if (!steps.length) return;
    // One live run per automation per target: a restart replaces the old one.
    await prisma.crmAutomationRun.updateMany({
      where: { automationId: a.id, status: "active", ...(target.leadId ? { leadId: target.leadId } : { businessId: target.businessId }) },
      data: { status: "stopped", stopReason: "restarted" },
    });
    const nextAt = await stepTime(steps[0], new Date(), target.context);
    await prisma.crmAutomationRun.create({
      data: {
        automationId: a.id, leadId: target.leadId ?? null, businessId: target.businessId ?? null,
        stepIndex: 0, nextAt, status: nextAt ? "active" : "done", context: target.context ? JSON.stringify(target.context) : null,
      },
    });
  } catch (e) { console.error("[crm] startAutomation", key, e); }
}

/** Stop every live run of a lead (rep pressed "עצור", or the lead opted out). */
export async function stopLeadAutomations(leadId: string, reason: string): Promise<number> {
  const r = await prisma.crmAutomationRun.updateMany({ where: { leadId, status: "active" }, data: { status: "stopped", stopReason: reason } });
  return r.count;
}

async function stepTime(step: AutoStep, from: Date, ctx?: RunContext): Promise<Date | null> {
  if (step.beforeCallMinutes != null) {
    if (!ctx?.callId) return null;
    const call = await prisma.salesCall.findUnique({ where: { id: ctx.callId }, select: { startsAt: true } });
    if (!call) return null;
    const at = new Date(call.startsAt.getTime() - step.beforeCallMinutes * 60_000);
    return at.getTime() > Date.now() - 60_000 ? at : null; // passed → skip
  }
  return new Date(from.getTime() + (step.delayMinutes ?? 0) * 60_000);
}

async function shouldStop(stopOn: StopReason[], run: { leadId: string | null; businessId: string | null; startedAt: Date; context: string | null }): Promise<StopReason | null> {
  if (!stopOn.length) return null;
  const lead = run.leadId ? await prisma.lead.findUnique({ where: { id: run.leadId }, select: { optedOut: true, stage: true, lastInboundAt: true, businessId: true } }) : null;
  const ctx: RunContext = run.context ? JSON.parse(run.context) : {};
  for (const r of stopOn) {
    if (r === "opted_out" && lead?.optedOut) return r;
    if (r === "not_relevant" && lead?.stage === "not_relevant") return r;
    if (r === "replied" && lead?.lastInboundAt && lead.lastInboundAt > run.startedAt) return r;
    if (r === "call_booked" && run.leadId && await prisma.salesCall.count({ where: { leadId: run.leadId, status: "booked", createdAt: { gt: run.startedAt } } })) return r;
    if (r === "call_cancelled" && ctx.callId) {
      const c = await prisma.salesCall.findUnique({ where: { id: ctx.callId }, select: { status: true } });
      if (!c || c.status !== "booked") return r;
    }
    const bizId = run.businessId ?? lead?.businessId ?? null;
    if ((r === "onboarding_done" || r === "paid") && bizId) {
      const b = await prisma.business.findUnique({ where: { id: bizId }, select: { onboardingCompletedAt: true, paidAt: true } });
      if (r === "onboarding_done" && b?.onboardingCompletedAt) return r;
      if (r === "paid" && b?.paidAt) return r;
    }
  }
  return null;
}

/** Fill {variables}. Free slots are read at send time, so they are always real. */
export async function renderText(text: string, target: { leadId?: string | null; businessId?: string | null; context?: RunContext }): Promise<{ body: string; phone: string | null; repPhone: string | null }> {
  const lead = target.leadId ? await prisma.lead.findUnique({ where: { id: target.leadId } }) : null;
  const bizId = target.businessId ?? lead?.businessId ?? null;
  const biz = bizId ? await prisma.business.findUnique({ where: { id: bizId }, select: { id: true, name: true, phone: true, settings: true } }) : null;
  const rep = lead?.repId ? await prisma.salesRep.findUnique({ where: { id: lead.repId } }) : await prisma.salesRep.findFirst({ where: { active: true }, orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }] });
  const call = target.context?.callId ? await prisma.salesCall.findUnique({ where: { id: target.context.callId } }) : null;
  let ownerPhone: string | null = null;
  if (biz) { try { const s = biz.settings ? JSON.parse(biz.settings) : {}; ownerPhone = s.ownerLoginPhone || biz.phone || null; } catch { ownerPhone = biz.phone; } }
  const needSlots = /\{שעה פנויה/.test(text);
  const slots = needSlots ? await freeCallSlots({ limit: 2 }) : [];
  const needLink = /\{קישור הקמה\}/.test(text) && biz;
  const link = needLink ? onboardingLinkFor(await signOnboardingToken(biz!.id)) : "";
  let ownerName = "";
  if (!lead && biz) { try { const s = biz.settings ? JSON.parse(biz.settings) : {}; ownerName = typeof s.ownerName === "string" ? s.ownerName : ""; } catch { /* ignore */ } }
  const ownerLead = !lead && biz ? await prisma.lead.findFirst({ where: { businessId: biz.id }, select: { name: true } }) : null;
  const firstName = (lead?.name ?? ownerLead?.name ?? ownerName ?? "").trim().split(/\s+/)[0] || "";
  const vars: Record<string, string> = {
    "{שם}": firstName,
    "{שם העסק}": lead?.businessName || biz?.name || "המספרה",
    "{שעת השיחה}": call ? slotLabel(call.startsAt) : "",
    "{שם הנציג}": rep?.name || "יאיר",
    "{שעה פנויה ראשונה}": slots[0] ? slotLabel(slots[0].startsAt) : "השבוע",
    "{שעה פנויה שנייה}": slots[1] ? slotLabel(slots[1].startsAt) : "בשעה שנוחה לך",
    "{קישור הקמה}": link,
    "{השלב שנתקע}": target.context?.stepLabel ?? "",
  };
  let body = text;
  for (const [k, v] of Object.entries(vars)) body = body.split(k).join(v);
  body = body.replace(/היי ,/g, "היי,").replace(/ {2,}/g, " ").trim();
  return { body, phone: lead?.phone ?? ownerPhone, repPhone: rep?.phone ?? null };
}

/** Advance due runs. Called every minute from the drip-queue piggyback. */
export async function tickAutomations(now = new Date()): Promise<{ sent: number; stopped: number }> {
  let sent = 0, stopped = 0;
  const due = await prisma.crmAutomationRun.findMany({ where: { status: "active", nextAt: { lte: now } }, take: 50, orderBy: { nextAt: "asc" } });
  if (!due.length) return { sent, stopped };
  const autos = await prisma.crmAutomation.findMany({ where: { id: { in: Array.from(new Set(due.map(d => d.automationId))) } } });
  for (const run of due) {
    const a = autos.find(x => x.id === run.automationId);
    if (!a || !a.enabled) { await prisma.crmAutomationRun.update({ where: { id: run.id }, data: { status: "stopped", stopReason: "automation_off" } }); stopped++; continue; }
    const steps = parseSteps(a.steps);
    const reason = await shouldStop(parseStopOn(a.stopOn), run);
    if (reason) { await prisma.crmAutomationRun.update({ where: { id: run.id }, data: { status: "stopped", stopReason: reason } }); stopped++; continue; }
    const step = steps[run.stepIndex];
    if (!step) { await prisma.crmAutomationRun.update({ where: { id: run.id }, data: { status: "done", nextAt: null } }); continue; }
    // Claim the step first so two overlapping ticks can never send it twice.
    const claim = await prisma.crmAutomationRun.updateMany({ where: { id: run.id, stepIndex: run.stepIndex, status: "active" }, data: { stepIndex: run.stepIndex + 1, nextAt: null } });
    if (!claim.count) continue;
    const ctx: RunContext = run.context ? JSON.parse(run.context) : {};
    const { body, phone, repPhone } = await renderText(step.text, { leadId: run.leadId, businessId: run.businessId, context: ctx });
    const to = a.audience === "rep" ? repPhone : phone;
    if (to && body) {
      await enqueueMessage({ businessId: DEMO_BUSINESS_ID, customerPhone: normalizeIsraeliPhone(to), kind: a.audience === "rep" ? "crm_rep_alert" : "crm_message", body, scheduledFor: now });
      sent++;
    }
    const next = steps[run.stepIndex + 1];
    const nextAt = next ? await stepTime(next, now, ctx) : null;
    await prisma.crmAutomationRun.update({ where: { id: run.id }, data: next && nextAt ? { nextAt } : { status: "done", nextAt: null } });
  }
  return { sent, stopped };
}

/** Daily-ish scans that start time-based automations (trial ending, follow-up dates, churn risk). Idempotent. */
export async function scanTimeTriggers(now = new Date()): Promise<void> {
  try { const { scanStuckSetups } = await import("@/lib/crm/setup-progress"); await scanStuckSetups(); } catch (e) { console.error("[crm] stuck setups", e); }
  const autos = await prisma.crmAutomation.findMany({ where: { enabled: true, key: { in: ["trial_ending", "followup", "churn_risk"] } }, select: { id: true, key: true } });
  const has = (k: string) => autos.find(a => a.key === k);
  const already = async (automationId: string, where: { leadId?: string; businessId?: string }, sinceDays: number) =>
    (await prisma.crmAutomationRun.count({ where: { automationId, ...where, startedAt: { gte: new Date(now.getTime() - sinceDays * 86400_000) } } })) > 0;

  const trial = has("trial_ending");
  if (trial) {
    const ending = await prisma.business.findMany({ where: { paidAt: null, suspendedAt: null, trialEndsAt: { gte: now, lte: new Date(now.getTime() + 5 * 86400_000) } }, select: { id: true } });
    for (const b of ending) if (!(await already(trial.id, { businessId: b.id }, 30))) await startAutomation("trial_ending", { businessId: b.id });
  }
  const fu = has("followup");
  if (fu) {
    const leads = await prisma.lead.findMany({ where: { followUpAt: { lte: now }, optedOut: false, stage: { notIn: ["not_relevant", "paying", "trial"] } }, select: { id: true } });
    for (const l of leads) {
      await prisma.lead.update({ where: { id: l.id }, data: { followUpAt: null } });
      await startAutomation("followup", { leadId: l.id });
    }
  }
  const churn = has("churn_risk");
  if (churn) {
    const paying = await prisma.business.findMany({ where: { paidAt: { not: null }, suspendedAt: null }, select: { id: true } });
    for (const b of paying) {
      const recent = await prisma.appointment.count({ where: { businessId: b.id, createdAt: { gte: new Date(now.getTime() - 7 * 86400_000) } } });
      if (!recent && !(await already(churn.id, { businessId: b.id }, 7))) await startAutomation("churn_risk", { businessId: b.id });
    }
  }
}
