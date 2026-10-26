/**
 * The SaaS dashboard (26.10.2026, Yair: "פירוט מעמיק מאוד לסאאס"; spec and GPT's review in
 * agents/dev-chator/עיצובים/דשבורד/אפיון.md). In the order of the screen: what needs action,
 * first value (the number that runs the business now: a trial whose agent booked a real
 * appointment within 7 days of signing up), every account, the acquisition funnel and sales,
 * revenue, costs, retention. Every number says when it rests on too little data.
 */
import { prisma } from "@/lib/prisma";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { NOT_TEST_USAGE } from "@/lib/agent/usage";
import { computeSetup } from "@/lib/crm/setup-progress";
import { getCrmSettings } from "@/lib/crm/core";
import { shopReports, OPEN_STAGES } from "@/lib/agent/shop-reports";
import { waFunnelView } from "@/lib/agent/wa-funnel-run";

const DAY = 86400_000;
/** Below this many, a rate is shown with "מעט נתונים". */
export const FEW = 10;
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const monthKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }).slice(0, 7);
const endOfMonth = (key: string) => { const [y, m] = key.split("-").map(Number); return new Date(Date.UTC(y, m, 1) - 1); };
const addMonths = (key: string, k: number) => { const [y, m] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7); };

export type SaasRange = "30" | "90" | "all";
export type Account = {
  id: string; name: string; stage: "setup" | "trial" | "paying" | "suspended"; days: number;
  live: boolean; setupDone: number; setupTotal: number; current: string | null; stuckHours: number;
  firstValueDays: number | null; appts7: number; convs7: number; escalated7: number; failed7: number;
  cost30Ils: number; reportsOpen: number; trialDaysLeft: number | null; price: number;
};

export async function saasDashboard(rangeRaw: string | null, now = new Date()) {
  const range: SaasRange = rangeRaw === "90" || rangeRaw === "all" ? rangeRaw : "30";
  const since = range === "all" ? new Date(0) : new Date(now.getTime() - Number(range) * DAY);
  const d7 = new Date(now.getTime() - 7 * DAY), d30 = new Date(now.getTime() - 30 * DAY);
  const settings = await getCrmSettings();

  const bizs = await prisma.business.findMany({
    where: { id: { notIn: [DEMO_BUSINESS_ID, SUPER_ADMIN_BUSINESS_ID] } },
    select: { id: true, name: true, createdAt: true, paidAt: true, suspendedAt: true, trialEndsAt: true, monthlyPrice: true, waLiveState: true, whatsappStatus: true },
    orderBy: { createdAt: "asc" },
  });
  const ids = bizs.map(b => b.id);
  const [setup, firstAppt, appts7, convs7, esc7, cost30, failed7, reports, leads, calls, invoices, demoCost, wa] = await Promise.all([
    computeSetup({ businessIds: ids }),
    prisma.appointment.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, source: "agent" }, _min: { createdAt: true } }),
    prisma.appointment.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, source: "agent", createdAt: { gte: d7 } }, _count: { _all: true } }),
    prisma.conversation.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, agentType: "customer", lastMessageAt: { gte: d7 } }, _count: { _all: true } }),
    prisma.conversation.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, escalatedAt: { gte: d7 } }, _count: { _all: true } }),
    prisma.agentUsage.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, createdAt: { gte: d30 }, ...NOT_TEST_USAGE }, _sum: { costUsd: true } }),
    prisma.messageLog.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, status: "failed", createdAt: { gte: d7 } }, _count: { _all: true } }),
    shopReports(ids),
    prisma.lead.findMany({ where: { createdAt: { gte: since } }, select: { source: true, stage: true, businessId: true } }),
    prisma.salesCall.findMany({ where: { startsAt: { gte: since } }, select: { status: true, outcome: true } }),
    prisma.crmInvoice.findMany({ where: { issuedAt: { gte: since } }, select: { amountIls: true, status: true } }),
    prisma.agentUsage.aggregate({ where: { businessId: DEMO_BUSINESS_ID, createdAt: { gte: since }, ...NOT_TEST_USAGE }, _sum: { costUsd: true } }),
    waFunnelView(now),
  ]);
  const of = <T extends { businessId: string }>(rows: T[], id: string) => rows.find(r => r.businessId === id);
  const ils = (usd: number | null | undefined) => Math.round((usd ?? 0) * settings.usdIls);

  // ── Every account ──────────────────────────────────────────────────────────
  const accounts: Account[] = bizs.map(b => {
    const st = setup.find(s => s.businessId === b.id);
    const first = of(firstAppt, b.id)?._min.createdAt ?? null;
    const stage: Account["stage"] = b.suspendedAt ? "suspended" : b.paidAt ? "paying" : st && !st.isLive ? "setup" : "trial";
    return {
      id: b.id, name: b.name, stage, days: Math.floor((now.getTime() - b.createdAt.getTime()) / DAY),
      live: !!st?.isLive, setupDone: st?.doneCount ?? 0, setupTotal: st?.steps.length ?? 0, current: st?.current?.label ?? null, stuckHours: st?.stuckHours ?? 0,
      firstValueDays: first ? Math.max(0, Math.round(((first.getTime() - b.createdAt.getTime()) / DAY) * 10) / 10) : null,
      appts7: of(appts7, b.id)?._count._all ?? 0, convs7: of(convs7, b.id)?._count._all ?? 0, escalated7: of(esc7, b.id)?._count._all ?? 0,
      failed7: of(failed7, b.id)?._count._all ?? 0, cost30Ils: ils(of(cost30, b.id)?._sum.costUsd),
      reportsOpen: (reports.get(b.id) ?? []).filter(r => OPEN_STAGES.has(r.stage)).length,
      trialDaysLeft: b.trialEndsAt && !b.paidAt ? Math.ceil((b.trialEndsAt.getTime() - now.getTime()) / DAY) : null,
      price: b.paidAt && !b.suspendedAt ? b.monthlyPrice ?? 0 : 0,
    };
  });
  const bizOf = (id: string) => bizs.find(b => b.id === id)!;
  const inRange = accounts.filter(a => bizOf(a.id).createdAt >= since);

  // ── What needs action (one reason per account, the most serious) ───────────
  const action = accounts.filter(a => a.stage !== "suspended").flatMap(a => {
    const b = bizOf(a.id);
    const r =
      b.whatsappStatus === "connected" && b.waLiveState !== "authorized" ? { tone: "bad", reason: "הוואטסאפ שלו מנותק: הסוכן לא עונה ללקוחות שלו" } :
      a.failed7 > 0 ? { tone: "bad", reason: `${a.failed7} הודעות לא יצאו השבוע` } :
      a.stage === "setup" && a.stuckHours >= 48 ? { tone: "bad", reason: `תקוע ${Math.floor(a.stuckHours / 24)} ימים בהקמה: ${a.current ?? ""}` } :
      a.trialDaysLeft != null && a.trialDaysLeft >= 0 && a.trialDaysLeft <= 3 ? { tone: "warn", reason: a.trialDaysLeft === 0 ? "הניסיון נגמר היום" : `הניסיון נגמר בעוד ${a.trialDaysLeft} ימים` } :
      a.live && a.firstValueDays == null && a.days >= 3 ? { tone: "warn", reason: "חי, ועוד אין תור אחד מהסוכן" } :
      a.live && a.firstValueDays != null && a.appts7 === 0 ? { tone: "warn", reason: "אין תורים מהסוכן 7 ימים" } :
      a.reportsOpen > 0 ? { tone: "warn", reason: `${a.reportsOpen} דיווחים פתוחים על הסוכן` } :
      null;
    return r ? [{ id: a.id, name: a.name, ...r }] : [];
  }).sort((x, y) => (x.tone === "bad" ? 0 : 1) - (y.tone === "bad" ? 0 : 1));

  // ── First value: the number that runs the business now ────────────────────
  const valueDays = inRange.map(a => a.firstValueDays).filter((x): x is number => x != null);
  const firstValue = {
    signedUp: inRange.length,
    within7: inRange.filter(a => a.firstValueDays != null && a.firstValueDays <= 7).length,
    reached: valueDays.length,
    medianDays: median(valueDays),
    live: inRange.filter(a => a.live).length,
    paying: inRange.filter(a => a.stage === "paying").length,
  };

  // ── Acquisition funnel and sales ──────────────────────────────────────────
  const contacts = wa.contacts;
  const reachedStage = (c: (typeof contacts)[number], min: number) => c.exit === "signed_up" || ["opened", "tried", "booked", "signup_link"].indexOf(c.stage) >= min;
  const funnel = [
    { label: "כתבו בוואטסאפ", n: contacts.length, note: "45 הימים האחרונים" },
    { label: "ניסו את הדמו", n: contacts.filter(c => reachedStage(c, 1)).length },
    { label: "קבעו תור בדמו", n: contacts.filter(c => reachedStage(c, 2)).length },
    { label: "קיבלו קישור הרשמה", n: contacts.filter(c => reachedStage(c, 3)).length },
    { label: "נרשמו", n: firstValue.signedUp },
    { label: "הגיעו לחי", n: firstValue.live },
    { label: "ערך ראשון", n: firstValue.reached },
    { label: "משלמים", n: firstValue.paying },
  ];
  const sources = Array.from(new Set(contacts.map(c => c.source)));
  const bySource = sources.map(s => {
    const cs = contacts.filter(c => c.source === s);
    return { source: s, contacts: cs.length, tried: cs.filter(c => reachedStage(c, 1)).length, toLead: cs.filter(c => c.exit === "lead").length, signedUp: cs.filter(c => c.exit === "signed_up").length };
  }).sort((a, b) => b.contacts - a.contacts);
  const LEAD_SOURCE: Record<string, string> = { landing: "אתר", whatsapp_demo: "דמו", whatsapp_keywords: "וואטסאפ", manual: "ידני", instagram: "אינסטגרם" };
  const leadsBySource = Object.entries(leads.reduce<Record<string, number>>((m, l) => { const k = LEAD_SOURCE[l.source] ?? l.source; m[k] = (m[k] ?? 0) + 1; return m; }, {})).map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n);
  const held = calls.filter(c => c.status === "done" || (c.outcome && c.outcome !== "no_answer")).length;
  const sales = {
    leads: leads.length, leadsBySource,
    callsBooked: calls.length, callsHeld: held, noAnswer: calls.filter(c => c.outcome === "no_answer").length, won: calls.filter(c => c.outcome === "won").length,
    closeRate: pct(calls.filter(c => c.outcome === "won").length, held),
  };

  // ── Revenue (from paid date, suspension and monthly price; no price history yet) ──
  const payingNow = accounts.filter(a => a.stage === "paying");
  const mrr = payingNow.reduce((s, a) => s + a.price, 0);
  const newMrr = bizs.filter(b => b.paidAt && b.paidAt >= since && !b.suspendedAt).reduce((s, b) => s + (b.monthlyPrice ?? 0), 0);
  const churnedMrr = bizs.filter(b => b.paidAt && b.suspendedAt && b.suspendedAt >= since).reduce((s, b) => s + (b.monthlyPrice ?? 0), 0);
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months.push(monthKey(d)); }
  const history = months.map(m => {
    const end = endOfMonth(m);
    return { month: m, mrr: bizs.filter(b => b.paidAt && b.paidAt <= end && (!b.suspendedAt || b.suspendedAt > end)).reduce((s, b) => s + (b.monthlyPrice ?? 0), 0) };
  });
  const trialsEnding = accounts.filter(a => a.trialDaysLeft != null && a.trialDaysLeft >= 0 && a.trialDaysLeft <= 7 && a.stage !== "suspended");
  const revenue = {
    mrr, arr: mrr * 12, paying: payingNow.length, arpa: payingNow.length ? Math.round(mrr / payingNow.length) : null,
    newMrr, churnedMrr, netNew: newMrr - churnedMrr, history,
    collected: invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.amountIls, 0),
    failedInvoices: invoices.filter(i => i.status === "failed").length,
    trialsEnding7: trialsEnding.length,
    trialToPaid: { paid: bizs.filter(b => b.paidAt && b.paidAt >= since).length, ended: bizs.filter(b => b.trialEndsAt && b.trialEndsAt >= since && b.trialEndsAt <= now).length },
  };

  // ── Costs ────────────────────────────────────────────────────────────────
  const agentIls30 = accounts.reduce((s, a) => s + a.cost30Ils, 0);
  const active = accounts.filter(a => a.stage !== "suspended");
  const chatorAgentIls = ils(demoCost._sum.costUsd);
  const costs = {
    agentIls30, perAccount: active.length ? Math.round(agentIls30 / active.length) : null, infraIls: settings.infraCostIls,
    chatorAgentIls, perLead: contacts.length + leads.length ? Math.round(chatorAgentIls / (contacts.length + leads.length)) : null,
    perSignup: firstValue.signedUp ? Math.round(chatorAgentIls / firstValue.signedUp) : null,
    grossMarginPct: mrr > 0 ? pct(mrr - agentIls30 - settings.infraCostIls, mrr) : null,
    top: [...accounts].sort((a, b) => b.cost30Ils - a.cost30Ils).slice(0, 3).filter(a => a.cost30Ils > 0).map(a => ({ id: a.id, name: a.name, ils: a.cost30Ils, price: a.price })),
  };

  // ── Retention: signup cohorts, still not suspended N months later ──────────
  const cohortMonths = Array.from(new Set(bizs.map(b => monthKey(b.createdAt)))).slice(-6);
  const cohorts = cohortMonths.map(m => {
    const group = bizs.filter(b => monthKey(b.createdAt) === m);
    // Still with us at the end of the k-th month after signing up (null: that month hasn't ended).
    const at = (k: number) => {
      const end = endOfMonth(addMonths(m, k));
      return end > now ? null : group.filter(b => !b.suspendedAt || b.suspendedAt > end).length;
    };
    return { month: m, signed: group.length, m1: at(1), m2: at(2), m3: at(3), paying: group.filter(b => b.paidAt && !b.suspendedAt).length };
  });
  const startActive = bizs.filter(b => b.createdAt < since && (!b.suspendedAt || b.suspendedAt >= since)).length;
  const suspendedInRange = bizs.filter(b => b.suspendedAt && b.suspendedAt >= since).length;
  const retention = { cohorts, suspendedInRange, logoChurnPct: range === "all" ? null : pct(suspendedInRange, startActive), startActive };

  return { range, since: since.toISOString(), action, firstValue, accounts, funnel, bySource, sales, revenue, costs, retention, few: FEW };
}
