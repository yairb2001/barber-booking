import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin, SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { sendMessage, mirrorToConversation } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { getBusinessNow, addDaysISO, appointmentInstant } from "@/lib/utils";
import { hasTestKey } from "@/lib/anthropic-clients";
import { ensureCrmSeed, getCrmSettings, setCrmSettings, freeCallSlots, slotLabel, isStage, STAGES, legacyStatusFor, type CrmSettings } from "@/lib/crm/core";
import { bookCall, cancelCall, setCallOutcome, type Outcome } from "@/lib/crm/calls";
import { startAutomation, stopLeadAutomations, parseSteps, parseStopOn, STOP_LABELS, VARIABLES, type AutoStep } from "@/lib/crm/automations";
import { computeSetup } from "@/lib/crm/setup-progress";
import { setupFieldsFor, type SetupConfig } from "@/lib/agent/setup-fields";
import { saveSetupAnswers, restoreSetupVersion } from "@/lib/agent/setup-save";
import { signOnboardingToken } from "@/lib/auth";
import { onboardingLinkFor } from "@/lib/leads";

export const dynamic = "force-dynamic";

/**
 * Chator CRM API — super-admin only. One route, `view` / `action` switch:
 *   GET  ?view=home | leads | lead&id= | calendar&week=YYYY-MM-DD | automations | customers | settings
 *   POST { action: … }  (see the switch below)
 */
async function guard(req: NextRequest) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await ensureCrmSeed();
  return null;
}

function monthStart(): Date {
  const { date } = getBusinessNow();
  return appointmentInstant(new Date(date.slice(0, 8) + "01T00:00:00Z"), "00:00");
}

function ownerPhoneOf(b: { phone: string | null; settings: string | null }): string | null {
  try { const s = b.settings ? JSON.parse(b.settings) : {}; return s.ownerLoginPhone || b.phone || null; } catch { return b.phone; }
}

// ─── Customers + health (shared by home and customers) ───────────────────────

async function customers(settings: CrmSettings) {
  const now = Date.now();
  const since = monthStart();
  const week = new Date(now - 7 * 86400_000);
  const bizs = await prisma.business.findMany({
    // Chator's own demo shop and Yair's own barbershop are not customers.
    where: { id: { notIn: [DEMO_BUSINESS_ID, SUPER_ADMIN_BUSINESS_ID] } },
    select: { id: true, name: true, slug: true, businessType: true, phone: true, settings: true, monthlyPrice: true, paidAt: true, suspendedAt: true, trialEndsAt: true, onboardingCompletedAt: true, createdAt: true, messagingProvider: true, waLiveState: true, whatsappStatus: true },
    orderBy: { createdAt: "desc" },
  });
  const ids = bizs.map(b => b.id);
  const [appts, usage, leads] = await Promise.all([
    prisma.appointment.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, createdAt: { gte: week } }, _count: { _all: true } }),
    prisma.agentUsage.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, createdAt: { gte: since }, kind: { not: "sandbox" } }, _sum: { costUsd: true } }),
    prisma.lead.findMany({ where: { businessId: { in: ids } }, select: { businessId: true, repId: true } }),
  ]);
  const reps = await prisma.salesRep.findMany({ select: { id: true, name: true } });
  return bizs.map(b => {
    const stage = b.suspendedAt ? "suspended" : b.paidAt ? "paying" : !b.onboardingCompletedAt ? "setup" : "trial";
    const waUp = b.waLiveState === "authorized";
    // "Disconnected" only for a number that was linked once; never linked = still in setup.
    const waKnown = b.whatsappStatus === "connected";
    const apptsWeek = appts.find(a => a.businessId === b.id)?._count._all ?? 0;
    const costIls = Math.round((usage.find(u => u.businessId === b.id)?._sum.costUsd ?? 0) * settings.usdIls);
    let budget = 40;
    try { const s = b.settings ? JSON.parse(b.settings) : {}; if (Number(s.tokenBudgetIls) > 0) budget = Number(s.tokenBudgetIls); } catch { /* ignore */ }
    const pkgPct = budget > 0 ? Math.min(100, Math.round((costIls / budget) * 100)) : 0;
    const trialDaysLeft = b.trialEndsAt && !b.paidAt ? Math.ceil((b.trialEndsAt.getTime() - now) / 86400_000) : null;
    const issues: { tone: "bad" | "warn"; text: string }[] = [];
    if (waKnown && !waUp && stage !== "suspended") issues.push({ tone: "bad", text: "וואטסאפ מנותק" });
    if (stage !== "setup" && stage !== "suspended" && !waKnown && !waUp) issues.push({ tone: "warn", text: "וואטסאפ עוד לא חובר" });
    if (stage === "paying" && apptsWeek === 0) issues.push({ tone: "bad", text: "אין תורים 7 ימים" });
    if (trialDaysLeft != null && trialDaysLeft <= 5 && trialDaysLeft >= 0) issues.push({ tone: "warn", text: `ניסיון נגמר בעוד ${trialDaysLeft} ימים` });
    if (pkgPct >= 80) issues.push({ tone: "warn", text: `חבילת הסוכן ${pkgPct}%` });
    const price = b.paidAt && !b.suspendedAt ? (b.monthlyPrice ?? 0) : 0;
    if (price > 0 && costIls > price) issues.push({ tone: "bad", text: "עולה לנו יותר ממה שמשלם" });
    const health = issues.some(i => i.tone === "bad") ? "bad" : issues.length ? "warn" : "ok";
    const repId = leads.find(l => l.businessId === b.id)?.repId ?? null;
    return {
      id: b.id, name: b.name, slug: b.slug, businessType: b.businessType, ownerPhone: ownerPhoneOf(b), stage, health, issues,
      wa: !waKnown ? "none" : waUp ? "up" : "down", apptsWeek, pkgPct, costIls, price, trialDaysLeft,
      rep: reps.find(r => r.id === repId)?.name ?? null, createdAt: b.createdAt,
    };
  });
}

// ─── Views ───────────────────────────────────────────────────────────────────

async function home() {
  const s = await getCrmSettings();
  const since = monthStart();
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const cust = await customers(s);
  const paying = cust.filter(c => c.stage === "paying");
  const mrr = paying.reduce((a, c) => a + c.price, 0);
  const newPayingThisMonth = await prisma.business.count({ where: { paidAt: { gte: since }, suspendedAt: null } });
  const churnedThisMonth = await prisma.business.count({ where: { suspendedAt: { gte: since } } });
  const [leadsWeek, leadsWeekBySource, leadsMonth, callsMonth, trialsMonth, payingMonth] = await Promise.all([
    prisma.lead.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.lead.groupBy({ by: ["source"], where: { createdAt: { gte: weekAgo } }, _count: { _all: true } }),
    prisma.lead.count({ where: { createdAt: { gte: since } } }),
    prisma.salesCall.findMany({ where: { createdAt: { gte: since } }, select: { leadId: true }, distinct: ["leadId"] }),
    prisma.lead.count({ where: { createdAt: { gte: since }, stage: { in: ["trial", "paying"] } } }),
    prisma.lead.count({ where: { createdAt: { gte: since }, stage: "paying" } }),
  ]);
  const owner = await prisma.salesRep.findFirst({ where: { isOwner: true } });
  const today = getBusinessNow().date;
  const dayStart = appointmentInstant(new Date(today + "T00:00:00Z"), "00:00");
  const dayEnd = appointmentInstant(new Date(addDaysISO(today, 1) + "T00:00:00Z"), "00:00");
  const callsToday = owner ? await prisma.salesCall.findMany({ where: { repId: owner.id, status: "booked", startsAt: { gte: dayStart, lt: dayEnd } }, orderBy: { startsAt: "asc" } }) : [];
  const callLeads = await prisma.lead.findMany({ where: { id: { in: callsToday.map(c => c.leadId) } }, select: { id: true, name: true, businessName: true, phone: true } });
  const freeToday = owner ? (await freeCallSlots({ repId: owner.id, fromISO: today, days: 1, limit: 20 })) : [];
  const staleLeads = await prisma.lead.findMany({ where: { stage: { in: ["new", "chatting"] }, optedOut: false, createdAt: { lte: new Date(Date.now() - 24 * 3600_000) }, OR: [{ lastInboundAt: null }, { lastInboundAt: { lte: new Date(Date.now() - 24 * 3600_000) } }] }, select: { id: true, name: true, phone: true, createdAt: true }, take: 5, orderBy: { createdAt: "asc" } });
  const usage = await prisma.agentUsage.aggregate({ where: { createdAt: { gte: since }, kind: { not: "sandbox" } }, _sum: { costUsd: true } });
  const tokensIls = Math.round((usage._sum.costUsd ?? 0) * s.usdIls);

  const setup = await computeSetup({ persist: true });
  const stuck = setup.filter(x => !x.isLive && x.current && x.stuckHours >= 48);
  const todo = [
    ...stuck.map(x => { const c = cust.find(y => y.id === x.businessId); return { tone: "warn" as const, tag: `הקמה תקועה ${Math.floor(x.stuckHours / 24)} ימים`, title: c?.name ?? "עסק", detail: `עצר ב: ${x.current!.label}`, href: `/admin/crm/customers/${x.businessId}`, kind: "customer" as const }; }),
    ...cust.filter(c => c.health !== "ok" && c.stage !== "suspended").flatMap(c => c.issues.slice(0, 1).map(i => ({ tone: i.tone, tag: i.text, title: c.name, detail: c.ownerPhone ? `בעלים: ${c.ownerPhone}` : "", href: `/admin/crm/customers/${c.id}`, kind: "customer" as const }))),
    ...staleLeads.map(l => ({ tone: "info" as const, tag: "ליד בלי מענה", title: l.name || l.phone, detail: `נכנס ${slotLabel(l.createdAt).replace(/ ב-.*/, "")}`, href: `/admin/crm/leads/${l.id}`, kind: "lead" as const })),
  ].slice(0, 8);

  return {
    testKey: hasTestKey(),
    kpis: { mrr, paying: paying.length, newPayingThisMonth, trials: cust.filter(c => c.stage === "trial").length, trialsEndingWeek: cust.filter(c => c.trialDaysLeft != null && c.trialDaysLeft <= 7 && c.trialDaysLeft >= 0).length, leadsWeek, leadsWeekBySource: leadsWeekBySource.map(x => ({ source: x.source, n: x._count._all })), churnedThisMonth, churnPct: paying.length + churnedThisMonth > 0 ? Math.round((churnedThisMonth / (paying.length + churnedThisMonth)) * 1000) / 10 : 0 },
    todo,
    funnel: [
      { label: "לידים", n: leadsMonth },
      { label: "שיחה נקבעה", n: callsMonth.length },
      { label: "התחילו ניסיון", n: trialsMonth },
      { label: "משלמים", n: payingMonth },
    ],
    callsToday: [
      ...callsToday.map(c => { const l = callLeads.find(x => x.id === c.leadId); return { at: c.startsAt, time: slotLabel(c.startsAt).replace("היום ב-", ""), leadId: c.leadId, name: l?.name || l?.phone || "ליד", shop: l?.businessName || "", booked: true }; }),
      ...freeToday.map(f => ({ at: f.startsAt, time: f.time, leadId: null, name: "פנוי", shop: "הסוכן יכול לקבוע כאן", booked: false })),
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    money: { revenue: mrr, tokensIls, infraIls: s.infraCostIls, left: mrr - tokensIls - s.infraCostIls },
  };
}

async function leadsView(q: string | null) {
  const where = q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { phone: { contains: q.replace(/\D/g, "") || q } }, { businessName: { contains: q, mode: "insensitive" as const } }] } : {};
  const leads = await prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, take: 400 });
  const ids = leads.map(l => l.id);
  const [calls, runs, reps] = await Promise.all([
    prisma.salesCall.findMany({ where: { leadId: { in: ids }, status: "booked" }, orderBy: { startsAt: "asc" } }),
    prisma.crmAutomationRun.findMany({ where: { leadId: { in: ids }, status: "active" }, select: { leadId: true, nextAt: true, automationId: true } }),
    prisma.salesRep.findMany({ select: { id: true, name: true } }),
  ]);
  const autos = await prisma.crmAutomation.findMany({ select: { id: true, name: true } });
  return {
    stages: STAGES,
    reps,
    leads: leads.map(l => {
      const call = calls.find(c => c.leadId === l.id);
      const run = runs.find(r => r.leadId === l.id);
      return {
        id: l.id, name: l.name, phone: l.phone, businessName: l.businessName, source: l.source, stage: l.stage, createdAt: l.createdAt, lastInboundAt: l.lastInboundAt, optedOut: l.optedOut,
        rep: reps.find(r => r.id === l.repId)?.name ?? null,
        next: call ? `שיחה ${slotLabel(call.startsAt)}` : run ? `${autos.find(a => a.id === run.automationId)?.name ?? "אוטומציה"}${run.nextAt ? ` · ${slotLabel(run.nextAt)}` : ""}` : l.followUpAt ? `לחזור ${slotLabel(l.followUpAt)}` : "",
      };
    }),
  };
}

async function leadView(id: string) {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return null;
  const local = lead.phone.replace(/^972/, "0");
  const intl = normalizeIsraeliPhone(lead.phone);
  const conv = await prisma.conversation.findFirst({ where: { businessId: DEMO_BUSINESS_ID, phone: { in: [intl, local] }, agentType: { not: "owner" } }, orderBy: { createdAt: "desc" }, select: { id: true, escalatedAt: true } });
  const [messages, calls, notes, runs, reps, autos, slots] = await Promise.all([
    conv ? prisma.conversationMessage.findMany({ where: { conversationId: conv.id, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "asc" }, take: 200, select: { id: true, role: true, content: true, source: true, createdAt: true } }) : [],
    prisma.salesCall.findMany({ where: { leadId: id }, orderBy: { startsAt: "desc" } }),
    prisma.leadNote.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" } }),
    prisma.crmAutomationRun.findMany({ where: { leadId: id }, orderBy: { startedAt: "desc" }, take: 10 }),
    prisma.salesRep.findMany({ where: { active: true }, select: { id: true, name: true } }),
    prisma.crmAutomation.findMany(),
    freeCallSlots({ limit: 12 }),
  ]);
  const activeRun = runs.find(r => r.status === "active");
  const activeAuto = activeRun ? autos.find(a => a.id === activeRun.automationId) : null;
  const activeSteps = activeAuto ? parseSteps(activeAuto.steps).map((s, i) => ({ text: s.text, done: i < (activeRun?.stepIndex ?? 0), when: i === activeRun?.stepIndex && activeRun?.nextAt ? slotLabel(activeRun.nextAt) : s.beforeCallMinutes != null ? `${s.beforeCallMinutes} דק׳ לפני השיחה` : s.delayMinutes ? `${Math.round(s.delayMinutes / 60)} שעות אחרי הקודם` : "מיד" })) : [];
  return {
    lead: { ...lead, rep: reps.find(r => r.id === lead.repId)?.name ?? null },
    stages: STAGES, reps,
    agentPausedUntil: conv?.escalatedAt && Date.now() - conv.escalatedAt.getTime() < 24 * 3600_000 ? new Date(conv.escalatedAt.getTime() + 24 * 3600_000) : null,
    messages,
    calls: calls.map(c => ({ ...c, label: slotLabel(c.startsAt), rep: reps.find(r => r.id === c.repId)?.name ?? "" })),
    notes,
    automation: activeAuto ? { runId: activeRun!.id, name: activeAuto.name, steps: activeSteps } : null,
    history: runs.filter(r => r.status !== "active").map(r => ({ name: autos.find(a => a.id === r.automationId)?.name ?? "", status: r.status, stopReason: r.stopReason, at: r.updatedAt })),
    slots: slots.map(s => ({ iso: s.startsAt.toISOString(), label: slotLabel(s.startsAt), repId: s.repId, rep: s.repName })),
  };
}

async function calendarView(weekISO: string | null) {
  const s = await getCrmSettings();
  const today = getBusinessNow().date;
  const base = weekISO && /^\d{4}-\d{2}-\d{2}$/.test(weekISO) ? weekISO : today;
  const dow = new Date(base + "T12:00:00Z").getUTCDay();
  const sunday = addDaysISO(base, -dow);
  const reps = await prisma.salesRep.findMany({ orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }] });
  const [windows, offs, calls] = await Promise.all([
    prisma.repWindow.findMany({ orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] }),
    prisma.repDayOff.findMany({ where: { date: { gte: new Date(sunday + "T00:00:00Z"), lt: new Date(addDaysISO(sunday, 7) + "T00:00:00Z") } } }),
    prisma.salesCall.findMany({ where: { status: { in: ["booked", "done"] }, startsAt: { gte: appointmentInstant(new Date(sunday + "T00:00:00Z"), "00:00"), lt: appointmentInstant(new Date(addDaysISO(sunday, 7) + "T00:00:00Z"), "00:00") } }, orderBy: { startsAt: "asc" } }),
  ]);
  const leads = await prisma.lead.findMany({ where: { id: { in: calls.map(c => c.leadId) } }, select: { id: true, name: true, phone: true, businessName: true } });
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const dateOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return {
    settings: s, today, sunday,
    days: Array.from({ length: 7 }, (_, i) => addDaysISO(sunday, i)),
    reps: reps.map(r => ({ ...r, windows: windows.filter(w => w.repId === r.id), daysOff: offs.filter(o => o.repId === r.id).map(o => o.date.toISOString().slice(0, 10)) })),
    calls: calls.map(c => { const l = leads.find(x => x.id === c.leadId); return { id: c.id, repId: c.repId, leadId: c.leadId, status: c.status, outcome: c.outcome, date: dateOf(c.startsAt), time: fmt(c.startsAt), name: l?.name || l?.phone || "ליד", shop: l?.businessName || "" }; }),
  };
}

async function automationsView() {
  const autos = await prisma.crmAutomation.findMany({ orderBy: { createdAt: "asc" } });
  const since = monthStart();
  const runs = await prisma.crmAutomationRun.groupBy({ by: ["automationId", "status"], where: { startedAt: { gte: since } }, _count: { _all: true } });
  const replied = await prisma.crmAutomationRun.groupBy({ by: ["automationId"], where: { startedAt: { gte: since }, stopReason: { in: ["replied", "call_booked"] } }, _count: { _all: true } });
  return {
    variables: VARIABLES,
    stopLabels: STOP_LABELS,
    automations: autos.map(a => ({
      id: a.id, key: a.key, name: a.name, trigger: a.trigger, enabled: a.enabled, audience: a.audience,
      steps: parseSteps(a.steps), stopOn: parseStopOn(a.stopOn),
      stats: { started: runs.filter(r => r.automationId === a.id).reduce((n, r) => n + r._count._all, 0), active: runs.find(r => r.automationId === a.id && r.status === "active")?._count._all ?? 0, replied: replied.find(r => r.automationId === a.id)?._count._all ?? 0 },
    })),
  };
}

async function customerView(id: string) {
  const s = await getCrmSettings();
  const all = await customers(s);
  const c = all.find(x => x.id === id);
  if (!c) return null;
  const biz = await prisma.business.findUnique({ where: { id }, select: { id: true, name: true, slug: true, businessType: true, monthlyPrice: true, paidAt: true, trialEndsAt: true, suspendedAt: true, createdAt: true, settings: true, tier: true } });
  const [setup] = await computeSetup({ businessIds: [id], persist: true });
  const agent = await prisma.agentConfig.findUnique({ where: { businessId: id }, select: { isEnabled: true, setupConfig: true, systemPrompt: true, agentName: true, faqs: { select: { id: true, question: true, answer: true } } } });
  let cfg: SetupConfig = {};
  try { cfg = agent?.setupConfig ? JSON.parse(agent.setupConfig) : {}; } catch { cfg = {}; }
  const fields = setupFieldsFor(biz?.businessType).map(f => ({ key: f.key, label: f.label, group: f.group, question: f.question, type: f.type, options: f.options ?? null, core: f.core, value: cfg[f.key] ?? null, default: f.default ?? null }));
  const week = new Date(Date.now() - 7 * 86400_000);
  const [convs, escalated, agentAppts, notes, history, lead] = await Promise.all([
    prisma.conversation.count({ where: { businessId: id, lastMessageAt: { gte: week }, NOT: { phone: { startsWith: "972000" } } } }),
    prisma.conversation.count({ where: { businessId: id, escalatedAt: { gte: week } } }),
    prisma.appointment.count({ where: { businessId: id, source: "agent", createdAt: { gte: week } } }),
    prisma.leadNote.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.agentSetupHistory.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, author: true, createdAt: true } }),
    prisma.lead.findFirst({ where: { businessId: id }, select: { id: true, name: true, phone: true, createdAt: true } }),
  ]);
  let budget = 40;
  try { const st = biz?.settings ? JSON.parse(biz.settings) : {}; if (Number(st.tokenBudgetIls) > 0) budget = Number(st.tokenBudgetIls); } catch { /* ignore */ }
  return {
    customer: c, business: biz && { ...biz, settings: undefined, tokenBudgetIls: budget }, setup,
    agent: { enabled: !!agent?.isEnabled, customPrompt: !!agent?.systemPrompt?.trim(), name: agent?.agentName ?? null, fields, faqs: agent?.faqs ?? [], history },
    quality: { conversationsWeek: convs, escalatedWeek: escalated, agentBookingsWeek: agentAppts },
    notes, lead,
  };
}

export async function GET(req: NextRequest) {
  const g = await guard(req); if (g) return g;
  const sp = new URL(req.url).searchParams;
  const view = sp.get("view") ?? "home";
  try {
    if (view === "home") return NextResponse.json(await home());
    if (view === "leads") return NextResponse.json(await leadsView(sp.get("q")));
    if (view === "lead") { const v = await leadView(sp.get("id") ?? ""); return v ? NextResponse.json(v) : NextResponse.json({ error: "not_found" }, { status: 404 }); }
    if (view === "calendar") return NextResponse.json(await calendarView(sp.get("week")));
    if (view === "automations") return NextResponse.json(await automationsView());
    if (view === "customers") {
      const [cust, setup] = await Promise.all([customers(await getCrmSettings()), computeSetup({ persist: true })]);
      return NextResponse.json({ customers: cust.map(c => {
        const st = setup.find(x => x.businessId === c.id);
        const segment = c.stage === "suspended" ? "suspended" : st && !st.isLive ? "setup" : c.health === "bad" ? "risk" : "live";
        return { ...c, segment, setup: st ? { doneCount: st.doneCount, total: st.steps.length, current: st.current?.label ?? null, stuckHours: st.stuckHours } : null };
      }) });
    }
    if (view === "customer") { const v = await customerView(sp.get("id") ?? ""); return v ? NextResponse.json(v) : NextResponse.json({ error: "not_found" }, { status: 404 }); }
    if (view === "settings") return NextResponse.json({ settings: await getCrmSettings(), testKey: hasTestKey(), reps: await prisma.salesRep.findMany({ orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }] }) });
    return NextResponse.json({ error: "unknown_view" }, { status: 400 });
  } catch (e) {
    console.error("[crm GET]", view, e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const g = await guard(req); if (g) return g;
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  try {
    switch (b.action) {
      case "lead.create": {
        const phone = normalizeIsraeliPhone(str("phone"));
        if (phone.replace(/\D/g, "").length < 9) return NextResponse.json({ error: "טלפון לא תקין" }, { status: 400 });
        const rep = await prisma.salesRep.findFirst({ where: { active: true }, orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }] });
        const lead = await prisma.lead.create({ data: { phone: phone.replace(/^972/, "0"), name: str("name") || null, businessName: str("businessName") || null, source: "manual", status: "new", stage: "new", repId: rep?.id ?? null } });
        if (b.startAutomation === true) await startAutomation("lead_new", { leadId: lead.id });
        return NextResponse.json({ ok: true, id: lead.id });
      }
      case "lead.update": {
        const id = str("id");
        const data: Record<string, unknown> = {};
        if (isStage(b.stage)) { data.stage = b.stage; data.status = legacyStatusFor(b.stage); }
        for (const k of ["name", "businessName", "shopSize", "lostReason"]) if (typeof b[k] === "string") data[k] = (b[k] as string).trim() || null;
        if (typeof b.repId === "string") data.repId = b.repId || null;
        if (b.followUpAt === null || typeof b.followUpAt === "string") data.followUpAt = b.followUpAt ? new Date(b.followUpAt as string) : null;
        await prisma.lead.update({ where: { id }, data });
        if (data.stage === "not_relevant") await stopLeadAutomations(id, "not_relevant");
        return NextResponse.json({ ok: true });
      }
      case "lead.note": {
        const body = str("body");
        if (!body) return NextResponse.json({ error: "empty" }, { status: 400 });
        await prisma.leadNote.create({ data: { leadId: str("id"), author: str("author") || "יאיר", body } });
        return NextResponse.json({ ok: true });
      }
      case "lead.message": {
        const lead = await prisma.lead.findUnique({ where: { id: str("id") } });
        const body = str("body");
        if (!lead || !body) return NextResponse.json({ error: "missing" }, { status: 400 });
        const phone = normalizeIsraeliPhone(lead.phone);
        const r = await sendMessage({ businessId: DEMO_BUSINESS_ID, customerPhone: phone, kind: "manual", body });
        if (!r.ok) return NextResponse.json({ error: r.error || "send_failed" }, { status: 502 });
        await mirrorToConversation(DEMO_BUSINESS_ID, phone, body, "admin");
        // A person took over → the sales agent stays quiet for 24h (like a reply typed on the phone).
        await prisma.conversation.updateMany({ where: { businessId: DEMO_BUSINESS_ID, phone }, data: { escalatedAt: new Date() } });
        if (lead.stage === "new") await prisma.lead.update({ where: { id: lead.id }, data: { stage: "chatting", status: "contacted" } });
        return NextResponse.json({ ok: true });
      }
      case "lead.resumeAgent": {
        const lead = await prisma.lead.findUnique({ where: { id: str("id") } });
        if (lead) await prisma.conversation.updateMany({ where: { businessId: DEMO_BUSINESS_ID, phone: normalizeIsraeliPhone(lead.phone) }, data: { escalatedAt: null } });
        return NextResponse.json({ ok: true });
      }
      case "lead.stopAutomation": return NextResponse.json({ ok: true, stopped: await stopLeadAutomations(str("id"), "stopped_by_rep") });
      case "lead.startAutomation": { await startAutomation(str("key") as Parameters<typeof startAutomation>[0], { leadId: str("id") }); return NextResponse.json({ ok: true }); }
      case "call.book": {
        const r = await bookCall({ leadId: str("leadId"), startsAt: new Date(str("startsAt")), repId: str("repId") || null, bookedBy: "rep" });
        return r.ok ? NextResponse.json({ ok: true, label: r.label }) : NextResponse.json({ error: r.error }, { status: 409 });
      }
      case "call.cancel": return NextResponse.json({ ok: await cancelCall(str("callId"), "rep") });
      case "call.outcome": {
        const outcome = str("outcome") as Outcome;
        if (!["won", "later", "no_answer", "not_relevant"].includes(outcome)) return NextResponse.json({ error: "bad_outcome" }, { status: 400 });
        const r = await setCallOutcome({ leadId: str("leadId"), outcome, callId: str("callId") || null, followUpAt: str("followUpAt") ? new Date(str("followUpAt")) : null, lostReason: str("lostReason") || null });
        return NextResponse.json(r);
      }
      case "rep.create": {
        const name = str("name");
        if (!name) return NextResponse.json({ error: "שם חסר" }, { status: 400 });
        const rep = await prisma.salesRep.create({ data: { name, phone: str("phone") ? normalizeIsraeliPhone(str("phone")).replace(/^972/, "0") : null } });
        return NextResponse.json({ ok: true, id: rep.id });
      }
      case "rep.update": {
        const data: Record<string, unknown> = {};
        if (typeof b.name === "string") data.name = str("name");
        if (typeof b.phone === "string") data.phone = str("phone") || null;
        if (typeof b.active === "boolean") data.active = b.active;
        await prisma.salesRep.update({ where: { id: str("id") }, data });
        return NextResponse.json({ ok: true });
      }
      case "rep.windows": {
        const repId = str("repId");
        const rows = Array.isArray(b.windows) ? (b.windows as { dayOfWeek: number; startTime: string; endTime: string }[]) : [];
        const valid = rows.filter(w => Number.isInteger(w.dayOfWeek) && w.dayOfWeek >= 0 && w.dayOfWeek <= 6 && /^\d{2}:\d{2}$/.test(w.startTime) && /^\d{2}:\d{2}$/.test(w.endTime) && w.startTime < w.endTime);
        await prisma.repWindow.deleteMany({ where: { repId } });
        if (valid.length) await prisma.repWindow.createMany({ data: valid.map(w => ({ repId, dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime })) });
        return NextResponse.json({ ok: true });
      }
      case "rep.dayOff": {
        const repId = str("repId"), date = str("date");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "bad_date" }, { status: 400 });
        const d = new Date(date + "T00:00:00Z");
        if (b.off === false) await prisma.repDayOff.deleteMany({ where: { repId, date: d } });
        else await prisma.repDayOff.upsert({ where: { repId_date: { repId, date: d } }, create: { repId, date: d, note: str("note") || null }, update: {} });
        return NextResponse.json({ ok: true });
      }
      case "settings.update": {
        const patch: Partial<CrmSettings> = {};
        for (const k of ["callMinutes", "breakMinutes", "horizonDays", "minNoticeMinutes", "infraCostIls"] as const) if (typeof b[k] === "number") patch[k] = b[k] as number;
        return NextResponse.json({ ok: true, settings: await setCrmSettings(patch) });
      }
      case "automation.update": {
        const data: Record<string, unknown> = {};
        if (typeof b.enabled === "boolean") data.enabled = b.enabled;
        if (typeof b.name === "string" && str("name")) data.name = str("name");
        if (Array.isArray(b.steps)) {
          const steps = parseSteps(JSON.stringify(b.steps as AutoStep[]));
          if (!steps.length) return NextResponse.json({ error: "צריך לפחות הודעה אחת" }, { status: 400 });
          data.steps = JSON.stringify(steps);
        }
        await prisma.crmAutomation.update({ where: { id: str("id") }, data });
        return NextResponse.json({ ok: true });
      }
      case "customer.note": {
        const body = str("body");
        if (!body) return NextResponse.json({ error: "empty" }, { status: 400 });
        await prisma.leadNote.create({ data: { businessId: str("id"), author: str("author") || "יאיר", body } });
        return NextResponse.json({ ok: true });
      }
      case "customer.message": {
        const biz = await prisma.business.findUnique({ where: { id: str("id") }, select: { phone: true, settings: true } });
        const body = str("body");
        const to = biz ? ownerPhoneOf(biz) : null;
        if (!to || !body) return NextResponse.json({ error: "אין טלפון לבעל העסק" }, { status: 400 });
        const phone = normalizeIsraeliPhone(to);
        const r = await sendMessage({ businessId: DEMO_BUSINESS_ID, customerPhone: phone, kind: "manual", body });
        if (!r.ok) return NextResponse.json({ error: r.error || "send_failed" }, { status: 502 });
        await mirrorToConversation(DEMO_BUSINESS_ID, phone, body, "admin");
        await prisma.leadNote.create({ data: { businessId: str("id"), author: "וואטסאפ", body: `נשלח לבעל העסק: ${body}` } });
        return NextResponse.json({ ok: true });
      }
      case "customer.resendLink": {
        const biz = await prisma.business.findUnique({ where: { id: str("id") }, select: { id: true, name: true, phone: true, settings: true } });
        const to = biz ? ownerPhoneOf(biz) : null;
        if (!biz || !to) return NextResponse.json({ error: "אין טלפון לבעל העסק" }, { status: 400 });
        const link = onboardingLinkFor(await signOnboardingToken(biz.id));
        const body = `היי, כאן Chator. הנה הקישור האישי להמשך ההקמה של ${biz.name}:\n${link}\n\nכל שלב נשמר, אפשר להמשיך מאיפה שעצרת.`;
        const phone = normalizeIsraeliPhone(to);
        const r = await sendMessage({ businessId: DEMO_BUSINESS_ID, customerPhone: phone, kind: "manual", body });
        if (!r.ok) return NextResponse.json({ error: r.error || "send_failed" }, { status: 502 });
        await mirrorToConversation(DEMO_BUSINESS_ID, phone, body, "admin");
        return NextResponse.json({ ok: true, link });
      }
      case "customer.setup": {
        const key = str("key");
        const field = setupFieldsFor((await prisma.business.findUnique({ where: { id: str("id") }, select: { businessType: true } }))?.businessType).find(f => f.key === key);
        if (!field) return NextResponse.json({ error: "unknown_field" }, { status: 400 });
        const value = field.type === "bool" ? b.value === true || b.value === "true" : str("value");
        await saveSetupAnswers(str("id"), { [key]: value }, "crm");
        return NextResponse.json({ ok: true });
      }
      case "customer.setupRestore": return NextResponse.json({ ok: await restoreSetupVersion(str("id"), str("historyId"), "crm") });
      case "automation.preview": {
        const { renderText } = await import("@/lib/crm/automations");
        const lead = await prisma.lead.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
        const r = await renderText(str("text"), { leadId: lead?.id ?? null });
        return NextResponse.json({ ok: true, body: r.body });
      }
    }
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (e) {
    console.error("[crm POST]", b.action, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "server_error" }, { status: 500 });
  }
}

