import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { NOT_TEST_USAGE } from "@/lib/agent/usage";
import { isSuperAdmin, SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { sendMessage, mirrorToConversation } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { getBusinessNow, addDaysISO, appointmentInstant } from "@/lib/utils";
import { hasTestKey } from "@/lib/anthropic-clients";
import { ensureCrmSeed, getCrmSettings, setCrmSettings, freeCallSlots, slotLabel, isStage, STAGES, legacyStatusFor, type CrmSettings } from "@/lib/crm/core";
import { bookCall, cancelCall, setCallOutcome, type Outcome } from "@/lib/crm/calls";
import { parseFix, parseReports, growthOf, needsGrowthOk, GROWTH_LIMIT } from "@/lib/agent/fix-queue";
import { startAutomation, stopLeadAutomations, parseSteps, parseStopOn, STOP_LABELS, VARIABLES, AUTOMATION_GROUPS, type AutoStep } from "@/lib/crm/automations";
import { computeSetup } from "@/lib/crm/setup-progress";
import { setupFieldsFor, type SetupConfig } from "@/lib/agent/setup-fields";
import { saveSetupAnswers, restoreSetupVersion } from "@/lib/agent/setup-save";
import { signOnboardingToken } from "@/lib/auth";
import { onboardingLinkFor } from "@/lib/leads";
import { getPlans, usageFor, planKeyOf, assignPlan, addPack, type PackKind } from "@/lib/crm/plans";
import { isConfigured as billingConfigured, createStandingOrderLink } from "@/lib/billing/invoice4u";

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
    select: { id: true, name: true, slug: true, businessType: true, phone: true, settings: true, monthlyPrice: true, paidAt: true, suspendedAt: true, trialEndsAt: true, onboardingCompletedAt: true, activatedAt: true, createdAt: true, messagingProvider: true, waLiveState: true, whatsappStatus: true },
    orderBy: { createdAt: "desc" },
  });
  const ids = bizs.map(b => b.id);
  const [appts, usage, leads] = await Promise.all([
    prisma.appointment.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, createdAt: { gte: week } }, _count: { _all: true } }),
    prisma.agentUsage.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, createdAt: { gte: since }, ...NOT_TEST_USAGE }, _sum: { costUsd: true } }),
    prisma.lead.findMany({ where: { businessId: { in: ids } }, select: { businessId: true, repId: true } }),
  ]);
  const reps = await prisma.salesRep.findMany({ select: { id: true, name: true } });
  const [plans, monthUsage] = await Promise.all([getPlans(), usageFor(ids)]);
  return bizs.map(b => {
    const stage = b.suspendedAt ? "suspended" : b.paidAt ? "paying" : !b.activatedAt ? "setup" : "trial";
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
      plan: plans.find(p => p.key === planKeyOf(b.settings))?.name ?? null,
      apptsMonth: monthUsage.get(b.id)?.appts ?? null,
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
  // Only leads from the last 14 days: a dead lead from months ago doesn't nag every morning (16.10.2026).
  const staleLeads = await prisma.lead.findMany({ where: { stage: { in: ["new", "chatting"] }, optedOut: false, createdAt: { lte: new Date(Date.now() - 24 * 3600_000), gte: new Date(Date.now() - 14 * 86400_000) }, OR: [{ lastInboundAt: null }, { lastInboundAt: { lte: new Date(Date.now() - 24 * 3600_000) } }] }, select: { id: true, name: true, phone: true, createdAt: true }, take: 5, orderBy: { createdAt: "asc" } });
  const usage = await prisma.agentUsage.aggregate({ where: { createdAt: { gte: since }, ...NOT_TEST_USAGE }, _sum: { costUsd: true } });
  const tokensIls = Math.round((usage._sum.costUsd ?? 0) * s.usdIls);

  // What Chator's own number costs (Yair, 10.10.2026: "כמה עלה לי הדמו, כולל
  // הקובע פגישות"): the sales agent + the demo shop's booking agent, real chats
  // only; the sandbox tests on its own line.
  const { DEMO_BUSINESS_ID: DEMO } = await import("@/lib/demo-widget");
  const todayStart = appointmentInstant(new Date(getBusinessNow().date + "T00:00:00Z"), "00:00");
  const [demoUse, demoToday, demoConvs, waLeads, agentCalls] = await Promise.all([
    prisma.agentUsage.groupBy({ by: ["kind"], where: { businessId: DEMO, createdAt: { gte: since } }, _sum: { costUsd: true } }),
    prisma.agentUsage.aggregate({ where: { businessId: DEMO, createdAt: { gte: todayStart }, ...NOT_TEST_USAGE }, _sum: { costUsd: true } }),
    prisma.conversation.count({ where: { businessId: DEMO, lastMessageAt: { gte: since }, NOT: { phone: { startsWith: "972000" } }, messages: { some: { role: "assistant", createdAt: { gte: since } } } } }),
    prisma.lead.count({ where: { createdAt: { gte: since }, source: { startsWith: "whatsapp" } } }),
    prisma.salesCall.count({ where: { createdAt: { gte: since }, bookedBy: "agent" } }),
  ]);
  const ils = (usd: number) => Math.round(usd * s.usdIls * 10) / 10;
  const kindUsd = (pred: (k: string) => boolean) => demoUse.filter(g => pred(g.kind ?? "")).reduce((a, g) => a + (g._sum.costUsd ?? 0), 0);
  const salesUsd = kindUsd(k => k === "sales" || k === "demo_sales");
  const testsUsd = kindUsd(k => k === "sandbox");
  const demoUsd = kindUsd(k => k !== "sales" && k !== "demo_sales" && k !== "sandbox");
  const chatorAgent = {
    monthIls: ils(salesUsd + demoUsd), salesIls: ils(salesUsd), demoIls: ils(demoUsd), testsIls: ils(testsUsd),
    todayIls: ils(demoToday._sum.costUsd ?? 0), convs: demoConvs, leads: waLeads, callsBooked: agentCalls,
  };

  const setup = await computeSetup({ persist: true });
  // A suspended (test) shop is not "stuck" (16.10.2026).
  const stuck = setup.filter(x => !x.isLive && x.current && x.stuckHours >= 48 && cust.find(c => c.id === x.businessId)?.stage !== "suspended");

  // ── Tasks (10.10.2026: "משימות בנפרד"): what Yair has to DO, derived from the
  // data, plus the ones he wrote himself. Each one links to where it is done.
  const now = new Date();
  const [pastCalls, followUps, manual, autosOn, nextFree] = await Promise.all([
    owner ? prisma.salesCall.findMany({ where: { repId: owner.id, status: "booked", startsAt: { lt: new Date(now.getTime() - 15 * 60_000), gte: new Date(now.getTime() - 14 * 86400_000) } }, orderBy: { startsAt: "asc" } }) : [],
    prisma.lead.findMany({ where: { followUpAt: { lt: dayEnd }, optedOut: false, stage: { notIn: ["paying", "not_relevant"] } }, select: { id: true, name: true, phone: true, businessName: true, followUpAt: true }, orderBy: { followUpAt: "asc" }, take: 10 }),
    prisma.crmTask.findMany({ where: { OR: [{ doneAt: null }, { doneAt: { gte: dayStart } }] }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }], take: 50 }),
    prisma.crmAutomation.count({ where: { enabled: true } }),
    owner ? freeCallSlots({ repId: owner.id, limit: 1 }) : [],
  ]);
  const taskLeads = await prisma.lead.findMany({ where: { id: { in: [...pastCalls.map(c => c.leadId), ...manual.map(t => t.leadId).filter((x): x is string => !!x)] } }, select: { id: true, name: true, phone: true, businessName: true } });
  const leadName = (id: string | null) => { const l = taskLeads.find(x => x.id === id); return l ? (l.name || l.phone) : null; };
  // Plan quotas at 80%+ and failed charges (10.10.2026).
  const planned = cust.filter(c => c.plan);
  const [quota, failed] = await Promise.all([
    usageFor(planned.map(c => c.id)),
    prisma.crmInvoice.findMany({ where: { status: "failed", issuedAt: { gte: new Date(now.getTime() - 14 * 86400_000) } }, orderBy: { issuedAt: "desc" } }),
  ]);
  const paidAfter = failed.length ? await prisma.crmInvoice.findMany({ where: { status: "paid", businessId: { in: failed.map(f => f.businessId) }, issuedAt: { gte: new Date(now.getTime() - 14 * 86400_000) } }, select: { businessId: true, issuedAt: true } }) : [];
  const unresolved = failed.filter((f, i) => failed.findIndex(x => x.businessId === f.businessId) === i && !paidAfter.some(p => p.businessId === f.businessId && p.issuedAt > f.issuedAt));
  type Task = { id: string; kind: "call" | "outcome" | "followup" | "lead" | "setup" | "customer" | "calendar" | "automations" | "manual" | "billing"; title: string; detail: string; href: string | null; time?: string | null; due?: string | null; overdue?: boolean; done?: boolean };
  const tasks: Task[] = [
    ...callsToday.filter(c => c.startsAt.getTime() > now.getTime() - 15 * 60_000).map(c => { const l = callLeads.find(x => x.id === c.leadId); return { id: `call-${c.id}`, kind: "call" as const, title: `להתקשר ל${l?.name || l?.phone || "ליד"}`, detail: [l?.businessName, l?.phone].filter(Boolean).join(" · "), href: `/admin/crm/leads/${c.leadId}`, time: slotLabel(c.startsAt).replace("היום ב-", "") }; }),
    ...pastCalls.map(c => ({ id: `outcome-${c.id}`, kind: "outcome" as const, title: `לסמן מה יצא מהשיחה עם ${leadName(c.leadId) || "הליד"}`, detail: `השיחה הייתה ${slotLabel(c.startsAt)}`, href: `/admin/crm/leads/${c.leadId}`, overdue: true })),
    ...followUps.map(l => ({ id: `follow-${l.id}`, kind: "followup" as const, title: `לחזור ל${l.name || l.phone}`, detail: [l.businessName, `נקבע ל${slotLabel(l.followUpAt!)}`].filter(Boolean).join(" · "), href: `/admin/crm/leads/${l.id}`, overdue: l.followUpAt! < dayStart })),
    ...staleLeads.map(l => ({ id: `stale-${l.id}`, kind: "lead" as const, title: `ליד בלי מענה יום: ${l.name || l.phone}`, detail: `נכנס ${slotLabel(l.createdAt).replace(/ ב-.*/, "")}`, href: `/admin/crm/leads/${l.id}` })),
    ...stuck.map(x => { const c = cust.find(y => y.id === x.businessId); return { id: `stuck-${x.businessId}`, kind: "setup" as const, title: `לעזור ל${c?.name ?? "עסק"} בהקמה`, detail: `תקוע ${Math.floor(x.stuckHours / 24)} ימים ב: ${x.current!.label}${c?.ownerPhone ? ` · ${c.ownerPhone}` : ""}`, href: `/admin/crm/customers/${x.businessId}` }; }),
    ...cust.filter(c => c.health === "bad" && c.stage !== "suspended").map(c => ({ id: `health-${c.id}`, kind: "customer" as const, title: `${c.name}: ${c.issues[0]?.text ?? "דורש טיפול"}`, detail: c.ownerPhone ? `בעלים: ${c.ownerPhone}` : "", href: `/admin/crm/customers/${c.id}` })),
    // The free month ends within 5 days and nothing is paid: without payment the business is locked out.
    ...cust.filter(c => c.stage !== "paying" && c.stage !== "suspended" && c.trialDaysLeft != null && c.trialDaysLeft >= 0 && c.trialDaysLeft <= 5).map(c => ({ id: `trial-${c.id}`, kind: "billing" as const, title: `לסגור תשלום עם ${c.name}`, detail: `החודש החינמי נגמר ${c.trialDaysLeft === 0 ? "היום" : c.trialDaysLeft === 1 ? "מחר" : `בעוד ${c.trialDaysLeft} ימים`}${c.plan ? ` · ${c.plan}` : ""}`, href: `/admin/crm/customers/${c.id}`, overdue: (c.trialDaysLeft ?? 9) <= 1 })),
    ...unresolved.map(f => ({ id: `fail-${f.id}`, kind: "billing" as const, title: `חיוב נכשל: ${cust.find(c => c.id === f.businessId)?.name ?? "לקוח"}`, detail: "לשלוח לו קישור לעדכון כרטיס", href: `/admin/crm/customers/${f.businessId}`, overdue: true })),
    ...planned.flatMap(c => { const u = quota.get(c.id); if (!u) return []; const top = (["messages", "ai"] as const).map(k => ({ k, m: u[k] })).filter(x => x.m.cap > 0 && x.m.pct >= 80).sort((a, b) => b.m.pct - a.m.pct)[0]; return top ? [{ id: `quota-${c.id}`, kind: "customer" as const, title: `${c.name}: ${top.m.pct}% מ${({ messages: "ההודעות", ai: "חבילת הסוכן" } as const)[top.k]} במסלול`, detail: "להציע מסלול גבוה יותר או חבילה", href: `/admin/crm/customers/${c.id}` }] : []; }),
    ...(owner && nextFree.length === 0 ? [{ id: "calendar-empty", kind: "calendar" as const, title: "לפתוח ימים לשיחות בשבוע הקרוב", detail: "אין לך אף זמן פתוח, אז הסוכן לא יכול לקבוע שיחות", href: "/admin/crm/calendar" }] : []),
    ...(autosOn === 0 ? [{ id: "automations-off", kind: "automations" as const, title: "לעבור על נוסחי האוטומציות ולהדליק", detail: "כולן כבויות, אז לידים חדשים לא מקבלים הודעה אוטומטית", href: "/admin/crm/automations" }] : []),
    ...manual.map(t => ({ id: t.id, kind: "manual" as const, title: t.title, detail: [leadName(t.leadId), t.businessId ? cust.find(c => c.id === t.businessId)?.name : null].filter(Boolean).join(" · "), href: t.leadId ? `/admin/crm/leads/${t.leadId}` : t.businessId ? `/admin/crm/customers/${t.businessId}` : null, due: t.dueAt ? t.dueAt.toISOString() : null, overdue: !t.doneAt && !!t.dueAt && t.dueAt < dayStart, done: !!t.doneAt })),
  ];

  // ── Notifications (separate from tasks): what happened, read/unread.
  const [notifications, unread] = await Promise.all([
    prisma.crmNotification.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.crmNotification.count({ where: { readAt: null } }),
  ]);

  return {
    testKey: hasTestKey(),
    tasks,
    notifications: notifications.map(n => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, href: n.href, at: n.createdAt, read: !!n.readAt })),
    unread,
    kpis: { mrr, paying: paying.length, newPayingThisMonth, trials: cust.filter(c => c.stage === "trial").length, trialsEndingWeek: cust.filter(c => c.trialDaysLeft != null && c.trialDaysLeft <= 7 && c.trialDaysLeft >= 0).length, leadsWeek, leadsWeekBySource: leadsWeekBySource.map(x => ({ source: x.source, n: x._count._all })), churnedThisMonth, churnPct: paying.length + churnedThisMonth > 0 ? Math.round((churnedThisMonth / (paying.length + churnedThisMonth)) * 1000) / 10 : 0 },
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
    chatorAgent,
  };
}

/**
 * "היום" (16.10.2026, Yair picked it from the CRM review): the home is one list
 * of what waits for him, each row with its action right there (call, WhatsApp,
 * open, done, tomorrow). One row per person or shop: everything else about the
 * same lead or business folds into it ("גם: ..."). Built on home()'s tasks plus
 * waiting chats, agent fixes and shop requests. Hidden rows: crm_settings
 * "todayHidden" ({ key: until }).
 */
type TodayRow = {
  key: string; kind: string; title: string; detail: string; time: string | null; urgent: boolean; order: number;
  href: string | null; phone: string | null; wa: string | null; also: string[];
  done: { action: string; id: string } | null; canHide: boolean;
};
async function todayHidden(): Promise<Record<string, string>> {
  const row = await prisma.crmSetting.findUnique({ where: { key: "todayHidden" } }).catch(() => null);
  try { return row ? JSON.parse(row.value) : {}; } catch { return {}; }
}
async function todayView() {
  const { DEMO_BUSINESS_ID: DEMO } = await import("@/lib/demo-widget");
  const h = await home();
  const now = Date.now();
  const ORDER: Record<string, number> = { call: 0, outcome: 1, billing: 1, chat: 2, approve: 3, request: 3, setup: 4, customer: 4, followup: 5, lead: 5, manual: 6, calendar: 7, automations: 7 };
  const entity = (href: string | null) => { const m = href?.match(/\/admin\/crm\/(leads|customers)\/([0-9a-f-]{36})/i); return m ? { kind: m[1] === "leads" ? "lead" : "biz", id: m[2] } : null; };
  const open = h.tasks.filter(t => !t.done);
  const leadIds = open.map(t => entity(t.href)).filter(e => e?.kind === "lead").map(e => e!.id);
  const bizIds = open.map(t => entity(t.href)).filter(e => e?.kind === "biz").map(e => e!.id);
  const [leads, bizs] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, phone: true } }),
    prisma.business.findMany({ where: { id: { in: bizIds } }, select: { id: true, phone: true, settings: true } }),
  ]);
  const phoneOf = (e: { kind: string; id: string } | null) => {
    if (!e) return null;
    if (e.kind === "lead") return leads.find(l => l.id === e.id)?.phone ?? null;
    const b = bizs.find(x => x.id === e.id); return b ? ownerPhoneOf(b) : null;
  };
  const rows: TodayRow[] = open.map(t => {
    const e = entity(t.href);
    return {
      key: t.id, kind: t.kind, title: t.title, detail: t.detail, time: t.time ?? null, urgent: !!t.overdue, order: (ORDER[t.kind] ?? 6) - (t.overdue ? 0.5 : 0),
      href: t.href, phone: phoneOf(e), wa: e ? `${t.href}?wa=1` : null, also: [],
      done: t.kind === "manual" ? { action: "task.toggle", id: t.id } : null, canHide: t.kind !== "call",
    };
  });

  // Chats on Chator's line waiting for a person (the last word is his, not yet handled).
  const chats = await prisma.conversation.findMany({
    where: { businessId: DEMO, agentType: { not: "owner" }, NOT: { phone: { startsWith: "972000" } }, lastMessageAt: { gte: new Date(now - 7 * 86400_000) } },
    orderBy: { lastMessageAt: "desc" }, take: 60,
    select: { id: true, phone: true, whatsappName: true, handledAt: true, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { role: true, content: true, createdAt: true } } },
  });
  const waitingChats = chats.filter(c => { const m = c.messages[0]; return m && m.role === "user" && m.createdAt.getTime() < now - 3 * 60_000 && !(c.handledAt && m.createdAt <= c.handledAt); }).slice(0, 10);
  const local = (p: string) => p.replace(/^972/, "0");
  const chatLeads = await prisma.lead.findMany({ where: { phone: { in: waitingChats.flatMap(c => [c.phone, local(c.phone)]) } }, select: { id: true, phone: true, name: true } });
  for (const c of waitingChats) {
    const l = chatLeads.find(x => local(x.phone) === local(c.phone));
    rows.push({ key: `chat-${c.id}`, kind: "chat", title: `מחכה לתשובה: ${l?.name || c.whatsappName || local(c.phone)}`, detail: c.messages[0].content.replace(/\s+/g, " ").slice(0, 90), time: null, urgent: false, order: ORDER.chat,
      href: `/admin/crm/chats/${c.id}`, phone: c.phone.startsWith("ig:") ? null : local(c.phone), wa: null, also: [], done: { action: "chat.handled", id: c.id }, canHide: true });
  }

  // Agent improvements and Chator's own agent asking him: one row.
  const [review, question, fresh, cq] = await Promise.all([
    prisma.agentImprovement.count({ where: { status: "review" } }),
    prisma.agentImprovement.count({ where: { status: "question" } }),
    prisma.agentImprovement.count({ where: { status: "pending" } }),
    prisma.chatorQuestion.count({ where: { status: "pending" } }),
  ]);
  const parts = [review && `${review} תיקונים לאישור`, question + cq && `${question + cq} שאלות אליך`, fresh && `${fresh} הצעות חדשות`].filter(Boolean) as string[];
  if (parts.length) rows.push({ key: `improve-${review}-${question + cq}-${fresh}`, kind: "approve", title: "שיפורי סוכן", detail: parts.join(" · "), time: null, urgent: review > 0, order: ORDER.approve, href: "/admin/crm/improvements", phone: null, wa: null, also: [], done: null, canHide: true });

  // Shop requests he hasn't seen, one row per shop.
  const reqs = await prisma.shopRequest.findMany({ where: { fromChator: false, seenAt: null }, orderBy: { createdAt: "desc" }, take: 50, select: { businessId: true, body: true, audioUrl: true } });
  const reqNames = new Map((await prisma.business.findMany({ where: { id: { in: Array.from(new Set(reqs.map(r => r.businessId))) } }, select: { id: true, name: true, phone: true, settings: true } })).map(b => [b.id, b]));
  for (const bid of Array.from(new Set(reqs.map(r => r.businessId)))) {
    const mine = reqs.filter(r => r.businessId === bid); const b = reqNames.get(bid);
    rows.push({ key: `request-${bid}-${mine.length}`, kind: "request", title: `בקשה מ${b?.name ?? "מספרה"}${mine.length > 1 ? ` (${mine.length})` : ""}`, detail: mine[0].body?.replace(/\s+/g, " ").slice(0, 90) || (mine[0].audioUrl ? "הודעה קולית" : ""), time: null, urgent: false, order: ORDER.request,
      href: "/admin/crm/requests", phone: b ? ownerPhoneOf(b) : null, wa: `/admin/crm/customers/${bid}?wa=1`, also: [], done: null, canHide: true });
  }

  // One row per person or shop: the most pressing one leads, the rest fold into it.
  const by = new Map<string, TodayRow>();
  const out: TodayRow[] = [];
  for (const r of rows.sort((a, b) => a.order - b.order || (a.time ?? "~").localeCompare(b.time ?? "~"))) {
    const e = entity(r.href) ?? (r.kind === "request" ? { kind: "biz", id: r.wa!.split("/")[4].split("?")[0] } : null);
    const k = e ? `${e.kind}:${e.id}` : null;
    const first = k ? by.get(k) : undefined;
    if (first) { first.also.push(r.title); first.urgent = first.urgent || r.urgent; continue; }
    if (k) by.set(k, r);
    out.push(r);
  }
  const hidden = await todayHidden();
  const visible = out.filter(r => !(hidden[r.key] && new Date(hidden[r.key]).getTime() > now));
  return { rows: visible, hiddenCount: out.length - visible.length, freeSlotsToday: h.callsToday.filter(c => !c.booked).length };
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
    conv ? prisma.conversationMessage.findMany({ where: { conversationId: conv.id, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "asc" }, take: 200, select: { id: true, role: true, content: true, source: true, createdAt: true, mediaUrl: true, mediaType: true } }) : [],
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
  const prevSunday = addDaysISO(sunday, -7);
  const [windows, dated, offs, calls] = await Promise.all([
    prisma.repWindow.findMany({ orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] }),
    // This week's opened days + last week's (for "כמו שבוע שעבר").
    prisma.repDateWindow.findMany({ where: { date: { gte: new Date(prevSunday + "T00:00:00Z"), lt: new Date(addDaysISO(sunday, 7) + "T00:00:00Z") } }, orderBy: [{ date: "asc" }, { startTime: "asc" }] }),
    prisma.repDayOff.findMany({ where: { date: { gte: new Date(sunday + "T00:00:00Z"), lt: new Date(addDaysISO(sunday, 7) + "T00:00:00Z") } } }),
    prisma.salesCall.findMany({ where: { status: { in: ["booked", "done"] }, startsAt: { gte: appointmentInstant(new Date(sunday + "T00:00:00Z"), "00:00"), lt: appointmentInstant(new Date(addDaysISO(sunday, 7) + "T00:00:00Z"), "00:00") } }, orderBy: { startsAt: "asc" } }),
  ]);
  const leads = await prisma.lead.findMany({ where: { id: { in: calls.map(c => c.leadId) } }, select: { id: true, name: true, phone: true, businessName: true } });
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const dateOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return {
    settings: s, today, sunday,
    days: Array.from({ length: 7 }, (_, i) => addDaysISO(sunday, i)),
    reps: reps.map(r => {
      const mine = dated.filter(w => w.repId === r.id).map(w => ({ date: w.date.toISOString().slice(0, 10), startTime: w.startTime, endTime: w.endTime }));
      return {
        ...r,
        week: mine.filter(w => w.date >= sunday),
        lastWeek: mine.filter(w => w.date < sunday),
        template: windows.filter(w => w.repId === r.id).map(w => ({ dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime })),
        daysOff: offs.filter(o => o.repId === r.id).map(o => o.date.toISOString().slice(0, 10)),
      };
    }),
    calls: calls.map(c => { const l = leads.find(x => x.id === c.leadId); return { id: c.id, repId: c.repId, leadId: c.leadId, status: c.status, outcome: c.outcome, date: dateOf(c.startsAt), time: fmt(c.startsAt), name: l?.name || l?.phone || "ליד", shop: l?.businessName || "" }; }),
  };
}

/** Every conversation a proposal points at: the one stored, then any "שיחה 5a90d6b3" its evidence names (15.10.2026). */
async function proposalConversations(i: { businessId: string; conversationId: string | null; evidence: string | null; reports?: string | null }): Promise<string[]> {
  const out = i.conversationId ? [i.conversationId] : [];
  // Every merged report's conversation too (15.10.2026).
  for (const r of parseReports(i.reports)) if (r.conversationId && !out.includes(r.conversationId)) out.push(r.conversationId);
  for (const prefix of Array.from(new Set((i.evidence ?? "").match(/\b[0-9a-f]{8}\b/g) ?? []))) {
    if (out.some(id => id.startsWith(prefix))) continue;
    const c = await prisma.conversation.findFirst({ where: { businessId: i.businessId, id: { startsWith: prefix } }, select: { id: true } });
    if (c) out.push(c.id);
  }
  return out;
}

async function automationsView() {
  const autos = await prisma.crmAutomation.findMany({ orderBy: { createdAt: "asc" } });
  const since = monthStart();
  const runs = await prisma.crmAutomationRun.groupBy({ by: ["automationId", "status"], where: { startedAt: { gte: since } }, _count: { _all: true } });
  const replied = await prisma.crmAutomationRun.groupBy({ by: ["automationId"], where: { startedAt: { gte: since }, stopReason: { in: ["replied", "call_booked"] } }, _count: { _all: true } });
  return {
    variables: VARIABLES,
    stopLabels: STOP_LABELS,
    groups: AUTOMATION_GROUPS,
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
  const biz = await prisma.business.findUnique({ where: { id }, select: { id: true, name: true, slug: true, phone: true, businessType: true, monthlyPrice: true, paidAt: true, trialEndsAt: true, suspendedAt: true, createdAt: true, settings: true, tier: true } });
  const [setup] = await computeSetup({ businessIds: [id], persist: true });
  const agent = await prisma.agentConfig.findUnique({ where: { businessId: id }, select: { isEnabled: true, setupConfig: true, systemPrompt: true, agentName: true, faqs: { select: { id: true, question: true, answer: true } } } });
  let cfg: SetupConfig = {};
  try { cfg = agent?.setupConfig ? JSON.parse(agent.setupConfig) : {}; } catch { cfg = {}; }
  const fields = setupFieldsFor(biz?.businessType).map(f => ({ key: f.key, label: f.label, group: f.group, question: f.question, type: f.type, options: f.options ?? null, core: f.core, value: cfg[f.key] ?? null, default: f.default ?? null }));
  const week = new Date(Date.now() - 7 * 86400_000);
  const [convs, escalated, agentAppts, notes, history, lead, refRows] = await Promise.all([
    prisma.conversation.count({ where: { businessId: id, lastMessageAt: { gte: week }, NOT: { phone: { startsWith: "972000" } } } }),
    prisma.conversation.count({ where: { businessId: id, escalatedAt: { gte: week } } }),
    prisma.appointment.count({ where: { businessId: id, source: "agent", createdAt: { gte: week } } }),
    prisma.leadNote.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.agentSetupHistory.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, author: true, createdAt: true } }),
    prisma.lead.findFirst({ where: { businessId: id }, select: { id: true, name: true, phone: true, createdAt: true } }),
    prisma.businessReferral.findMany({ where: { OR: [{ referrerId: id }, { referredId: id }] }, orderBy: { createdAt: "desc" } }),
  ]);
  // "חבר מביא חבר" between shops (src/lib/chator-referral.ts).
  const refNames = new Map((await prisma.business.findMany({ where: { id: { in: refRows.flatMap(r => [r.referrerId, r.referredId]) } }, select: { id: true, name: true } })).map(x => [x.id, x.name]));
  const by = refRows.find(r => r.referredId === id);
  const referral = {
    referredBy: by ? { id: by.referrerId, name: refNames.get(by.referrerId) ?? "", source: by.source } : null,
    brought: refRows.filter(r => r.referrerId === id).map(r => ({ id: r.id, businessId: r.referredId, name: refNames.get(r.referredId) ?? "", at: r.createdAt, rewardedAt: r.rewardedAt, appliedAt: r.appliedAt })),
  };
  let budget = 40;
  try { const st = biz?.settings ? JSON.parse(biz.settings) : {}; if (Number(st.tokenBudgetIls) > 0) budget = Number(st.tokenBudgetIls); } catch { /* ignore */ }
  // His WhatsApp with Chator's line, opened from the card (15.10.2026): his login, the shop's number and his lead's.
  const waPhones = Array.from(new Set([biz ? ownerPhoneOf(biz) : null, biz?.phone, lead?.phone]
    .map(p => (p ? normalizeIsraeliPhone(p) : "")).filter(p => p.startsWith("972")).flatMap(p => [p, "0" + p.slice(3)])));
  const waConvs = waPhones.length ? await prisma.conversation.findMany({ where: { businessId: DEMO_BUSINESS_ID, phone: { in: waPhones }, agentType: { not: "owner" } }, select: { id: true } }) : [];
  const messages = waConvs.length ? (await prisma.conversationMessage.findMany({ where: { conversationId: { in: waConvs.map(x => x.id) }, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, role: true, content: true, source: true, createdAt: true, mediaUrl: true, mediaType: true } })).reverse() : [];
  return {
    customer: c, business: biz && { ...biz, settings: undefined, phone: undefined, tokenBudgetIls: budget }, setup,
    agent: { enabled: !!agent?.isEnabled, customPrompt: !!agent?.systemPrompt?.trim(), platformNotes: typeof cfg.platformNotes === "string" ? cfg.platformNotes : "", name: agent?.agentName ?? null, fields, faqs: agent?.faqs ?? [], history },
    quality: { conversationsWeek: convs, escalatedWeek: escalated, agentBookingsWeek: agentAppts },
    notes, lead, referral, messages,
    billing: await billingOf(id, biz?.settings ?? null),
  };
}

/** The customer card's plan, this month's meters, packs and invoices. */
async function billingOf(id: string, settings: string | null) {
  const s = await getCrmSettings();
  const [plans, usage, invoices] = await Promise.all([
    getPlans(),
    usageFor([id]),
    prisma.crmInvoice.findMany({ where: { businessId: id }, orderBy: { issuedAt: "desc" }, take: 36 }),
  ]);
  const u = usage.get(id) ?? null;
  const packs = u ? await prisma.crmPack.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 24 }) : [];
  let billingEmail = "";
  try { billingEmail = String((settings ? JSON.parse(settings) : {}).billingEmail ?? ""); } catch { /* ignore */ }
  return {
    planKey: planKeyOf(settings), plans, usage: u, packs, invoices, billingEmail,
    packPrices: { messages: [s.packMessagesQty, s.packMessagesPrice], ai: [s.packAiIls, s.packAiPrice], marketing: [s.packMarketingQty, s.packMarketingPrice] },
    providerConnected: billingConfigured(),
  };
}

async function invoicesView() {
  const invoices = await prisma.crmInvoice.findMany({ orderBy: { issuedAt: "desc" }, take: 300 });
  const bizs = await prisma.business.findMany({ where: { id: { in: Array.from(new Set(invoices.map(i => i.businessId))) } }, select: { id: true, name: true } });
  return { providerConnected: billingConfigured(), invoices: invoices.map(i => ({ ...i, businessName: bizs.find(b => b.id === i.businessId)?.name ?? "—" })) };
}

export async function GET(req: NextRequest) {
  const g = await guard(req); if (g) return g;
  const sp = new URL(req.url).searchParams;
  const view = sp.get("view") ?? "home";
  try {
    if (view === "home") return NextResponse.json(await home());
    // The notifications screen, without the dashboard's heavy queries.
    if (view === "alerts") {
      const [list, unread] = await Promise.all([prisma.crmNotification.findMany({ orderBy: { createdAt: "desc" }, take: 60 }), prisma.crmNotification.count({ where: { readAt: null } })]);
      return NextResponse.json({ unread, notifications: list.map(n => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, href: n.href, at: n.createdAt, read: !!n.readAt })) });
    }
    // The daily agent review's proposals + the owners' notes about their agents (10.10.2026).
    // One conversation of a shop, read only, opened from an agent proposal or an owner's note (15.10.2026).
    if (view === "conversation") {
      const conv = await prisma.conversation.findUnique({ where: { id: sp.get("id") ?? "" }, select: { id: true, phone: true, whatsappName: true, businessId: true, escalatedAt: true, business: { select: { name: true } }, customer: { select: { name: true } } } });
      if (!conv) return NextResponse.json({ error: "השיחה לא נמצאה" }, { status: 404 });
      const messages = await prisma.conversationMessage.findMany({ where: { conversationId: conv.id, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "asc" }, take: 300, select: { id: true, role: true, content: true, source: true, createdAt: true, mediaUrl: true, mediaType: true } });
      return NextResponse.json({ conversation: { id: conv.id, businessId: conv.businessId, businessName: conv.business.name, name: conv.customer?.name || conv.whatsappName || null, phone: conv.phone.replace(/^972/, "0") }, messages });
    }
    if (view === "improvements") {
      const [items, feedback, cq, rulesText] = await Promise.all([
        // Open at every stage of the fix agent, plus what went live or closed in the last 30 days (15.10.2026).
        prisma.agentImprovement.findMany({ where: { OR: [{ status: { in: ["pending", "queued", "question", "review", "publish", "revert"] } }, { decidedAt: { gte: new Date(Date.now() - 30 * 86400_000) } }] }, orderBy: [{ createdAt: "desc" }], take: 300 }),
        prisma.agentFeedback.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
        // Chator's own agent asking Yair (14.10.2026).
        prisma.chatorQuestion.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 50 }),
        (await import("@/lib/crm/core")).getCrmText("supportRules"),
      ]);
      const bizIds = Array.from(new Set([...items.map(i => i.businessId), ...feedback.map(f => f.businessId), ...cq.map(q => q.businessId).filter((x): x is string => !!x)]));
      const bizs = await prisma.business.findMany({ where: { id: { in: bizIds } }, select: { id: true, name: true } });
      const name = (id: string) => bizs.find(b => b.id === id)?.name ?? "—";
      return NextResponse.json({
        items: await Promise.all(items.map(async i => { const fx = parseFix(i.fix); return { ...i, fix: fx, reports: parseReports(i.reports), growth: growthOf(fx), growthNeedsOk: needsGrowthOk(fx), businessName: name(i.businessId), conversations: (await proposalConversations(i)).slice(0, 6) }; })),
        growthLimit: GROWTH_LIMIT,
        feedback: feedback.map(f => ({ ...f, businessName: name(f.businessId) })),
        chatorQuestions: cq.map(q => ({ id: q.id, question: q.question, stage: q.stage, createdAt: q.createdAt, businessId: q.businessId, businessName: q.businessId ? name(q.businessId) : null, phone: q.phone.replace(/^972/, "0"), conversationId: q.conversationId })),
        supportRules: rulesText.text.split("\n").filter(Boolean).slice(-15),
      });
    }
    // Chator's own WhatsApp chats (10.10.2026, Yair: "צ'אטים בתפריט, בלי קבוצות").
    // Ready messages for the WhatsApp composer (20.10.2026): they fill the box, never send.
    if (view === "quickReplies") {
      const { getQuickReplies, quickReplyVars } = await import("@/lib/crm/quick-replies");
      const [items, vars] = await Promise.all([getQuickReplies(), quickReplyVars()]);
      return NextResponse.json({ items, vars });
    }
    if (view === "chats" || view === "chat") {
      const { DEMO_BUSINESS_ID: DEMO } = await import("@/lib/demo-widget");
      // Leads are saved as 05X, 9725X or +9725X; a chat's phone is any of these.
      const local = (p: string) => { const d = p.replace(/\D/g, ""); return d.startsWith("972") ? `0${d.slice(3)}` : d; };
      const forms = (p: string) => { const l = local(p); const i = `972${l.slice(1)}`; return [p, l, i, `+${i}`]; };
      if (view === "chats") {
        const convs = await prisma.conversation.findMany({
          where: { businessId: DEMO, agentType: { not: "owner" }, NOT: { phone: { startsWith: "972000" } }, lastMessageAt: { not: null } },
          orderBy: { lastMessageAt: "desc" }, take: 150,
          select: { id: true, phone: true, whatsappName: true, lastMessageAt: true, escalatedAt: true, handledAt: true, salesState: true, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { role: true, content: true, source: true, createdAt: true } } },
        });
        // WhatsApp numbers and Instagram DMs ("ig:<IGSID>", 12.10); no groups, no channels.
        const isIg = (p: string) => p.startsWith("ig:");
        const people = convs.filter(c => /^\d{8,15}$/.test(c.phone) || isIg(c.phone));
        const leads = await prisma.lead.findMany({ where: { phone: { in: people.filter(c => !isIg(c.phone)).flatMap(c => forms(c.phone)) } }, orderBy: { createdAt: "desc" }, select: { id: true, phone: true, name: true, stage: true, businessName: true } });
        const leadOf = (p: string) => (isIg(p) ? undefined : leads.find(l => local(l.phone) === local(p)));
        // Instagram: does the agent answer this person at all (settings.instagram.agent)?
        const { instagramAccountOf, instagramAgentAnswers, igsidOf } = await import("@/lib/messaging/instagram");
        const igAccount = instagramAccountOf((await prisma.business.findUnique({ where: { id: DEMO }, select: { settings: true } }))?.settings);
        const agentFor = (p: string) => !isIg(p) || (!!igAccount && instagramAgentAnswers(igAccount, igsidOf(p)));
        return NextResponse.json({ chats: people.map(c => {
          const l = leadOf(c.phone); const last = c.messages[0];
          let mode: string | null = null; try { mode = c.salesState ? JSON.parse(c.salesState).mode ?? null : null; } catch { /* none */ }
          return { id: c.id, channel: isIg(c.phone) ? "instagram" : "whatsapp", agent: agentFor(c.phone), phone: isIg(c.phone) ? "" : local(c.phone), name: l?.name || c.whatsappName || null, shop: l?.businessName ?? null, leadId: l?.id ?? null, stage: l?.stage ?? null, mode, at: c.lastMessageAt, last: last ? { role: last.role, source: last.source, text: last.content.slice(0, 120) } : null, waiting: last?.role === "user" && !(c.handledAt && last.createdAt <= c.handledAt), handled: !!c.handledAt && !!last && last.role === "user" && last.createdAt <= c.handledAt, paused: !!c.escalatedAt && Date.now() - c.escalatedAt.getTime() < 24 * 3600_000 };
        }) });
      }
      const conv = await prisma.conversation.findFirst({ where: { id: sp.get("id") ?? "", businessId: DEMO }, select: { id: true, phone: true, whatsappName: true, escalatedAt: true, handledAt: true, salesState: true } });
      if (!conv) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const ig = conv.phone.startsWith("ig:");
      // Opening the chat = you saw it: its alerts ("הודעה חדשה באינסטגרם") stop showing in the bell (12.10.2026).
      const seen = await prisma.crmNotification.updateMany({ where: { href: `/admin/crm/chats/${conv.id}`, readAt: null }, data: { readAt: new Date() } });
      const [msgs, lead] = await Promise.all([
        prisma.conversationMessage.findMany({ where: { conversationId: conv.id, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, role: true, content: true, source: true, createdAt: true, mediaUrl: true, mediaType: true } }),
        ig ? Promise.resolve(null) : prisma.lead.findFirst({ where: { phone: { in: forms(conv.phone) } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, stage: true, businessName: true, businessId: true } }),
      ]);
      // Instagram: does the agent answer this person at all (settings.instagram.agent off / test / on)?
      let agent = true;
      if (ig) {
        const { instagramAccountOf, instagramAgentAnswers, igsidOf } = await import("@/lib/messaging/instagram");
        const demo = await prisma.business.findUnique({ where: { id: DEMO }, select: { settings: true } });
        const account = instagramAccountOf(demo?.settings);
        agent = !!account && instagramAgentAnswers(account, igsidOf(conv.phone));
      }
      return NextResponse.json({ seen: seen.count, chat: { id: conv.id, channel: ig ? "instagram" : "whatsapp", agent, phone: ig ? "" : local(conv.phone), name: lead?.name || conv.whatsappName || null, lead, handledAt: conv.handledAt, paused: !!conv.escalatedAt && Date.now() - conv.escalatedAt.getTime() < 24 * 3600_000 }, messages: msgs.reverse() });
    }
    // The bell in the header: one cheap count.
    if (view === "today") return NextResponse.json(await todayView());
    if (view === "badge") {
      const [unread, requests] = await Promise.all([
        prisma.crmNotification.count({ where: { readAt: null } }),
        prisma.shopRequest.count({ where: { fromChator: false, seenAt: null } }),
      ]);
      return NextResponse.json({ unread, requests });
    }
    // Shops' requests (15.10.2026): one thread per shop; unseen first, then the latest.
    if (view === "requests") {
      const rows = await prisma.shopRequest.findMany({ orderBy: { createdAt: "desc" }, take: 2000, select: { businessId: true, fromChator: true, body: true, audioUrl: true, createdAt: true, seenAt: true, doneAt: true } });
      const by = new Map<string, { last: (typeof rows)[number]; unseen: number; open: number; total: number }>();
      for (const r of rows) {
        const t = by.get(r.businessId) ?? { last: r, unseen: 0, open: 0, total: 0 };
        if (!r.fromChator) { t.total++; if (!r.seenAt) t.unseen++; if (!r.doneAt) t.open++; }
        by.set(r.businessId, t);
      }
      const bizs = await prisma.business.findMany({ where: { id: { in: Array.from(by.keys()) } }, select: { id: true, name: true } });
      const threads = Array.from(by.entries()).map(([id, t]) => ({
        businessId: id, name: bizs.find(b => b.id === id)?.name ?? "—",
        last: t.last.body ?? (t.last.audioUrl ? "🎤 הקלטה" : ""), lastFromChator: t.last.fromChator, at: t.last.createdAt,
        unseen: t.unseen, open: t.open, total: t.total,
      })).sort((a, b) => (b.unseen > 0 ? 1 : 0) - (a.unseen > 0 ? 1 : 0) || +new Date(b.at) - +new Date(a.at));
      return NextResponse.json({ threads });
    }
    if (view === "requestThread") {
      const id = sp.get("id") ?? "";
      const biz = await prisma.business.findUnique({ where: { id }, select: { id: true, name: true } });
      if (!biz) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const items = await prisma.shopRequest.findMany({ where: { businessId: id }, orderBy: { createdAt: "asc" }, take: 500 });
      await prisma.shopRequest.updateMany({ where: { businessId: id, fromChator: false, seenAt: null }, data: { seenAt: new Date() } });
      return NextResponse.json({ business: biz, items: items.map(r => ({ id: r.id, fromChator: r.fromChator, author: r.authorName, body: r.body, audioUrl: r.audioUrl, audioSecs: r.audioSecs, at: r.createdAt, done: !!r.doneAt })) });
    }
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
    if (view === "invoices") return NextResponse.json(await invoicesView());
    if (view === "settings") {
      const { crmPushDevices } = await import("@/lib/crm/notify");
      const { getCrmText } = await import("@/lib/crm/core");
      const { SALES_KNOWLEDGE_V2 } = await import("@/lib/agent/sales-knowledge");
      const [knowledge, v2] = await Promise.all([getCrmText("salesKnowledge"), getCrmText("salesAgentV2")]);
      return NextResponse.json({ settings: await getCrmSettings(), testKey: hasTestKey(), pushDevices: await crmPushDevices(), plans: await getPlans(), providerConnected: billingConfigured(), reps: await prisma.salesRep.findMany({ orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }] }),
        salesAgent: { v2: v2.text === "1", v2At: v2.updatedAt, knowledge: knowledge.text.trim() || SALES_KNOWLEDGE_V2, custom: !!knowledge.text.trim(), knowledgeAt: knowledge.updatedAt } });
    }
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
      case "push.subscribe": {
        const sub = b.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
        if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
        const { addCrmPushSub } = await import("@/lib/crm/notify");
        await addCrmPushSub({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
        return NextResponse.json({ ok: true });
      }
      case "push.status": {
        const { crmPushHas } = await import("@/lib/crm/notify");
        return NextResponse.json({ ok: true, registered: str("endpoint") ? await crmPushHas(str("endpoint")) : false });
      }
      case "push.unsubscribe": {
        const { removeCrmPushSub } = await import("@/lib/crm/notify");
        if (str("endpoint")) await removeCrmPushSub(str("endpoint"));
        return NextResponse.json({ ok: true });
      }
      case "push.test": {
        const { sendCrmPush } = await import("@/lib/crm/notify");
        const sent = await sendCrmPush({ title: "✅ ההתראות של ה-CRM עובדות", body: "ככה ייראו: קצר, רק מה שצריך אותך.", url: "/admin/crm/alerts", tag: "crm-test" });
        return NextResponse.json({ ok: sent > 0, sent, error: sent ? undefined : "אין טלפון עם התראות פעילות" });
      }
      case "notif.read": {
        await prisma.crmNotification.updateMany({ where: { id: str("id"), readAt: null }, data: { readAt: new Date() } });
        return NextResponse.json({ ok: true });
      }
      case "notif.readAll": {
        await prisma.crmNotification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
        return NextResponse.json({ ok: true });
      }
      case "task.create": {
        const title = str("title");
        if (!title) return NextResponse.json({ error: "כתוב מה צריך לעשות" }, { status: 400 });
        const due = str("due");
        const dueAt = /^\d{4}-\d{2}-\d{2}$/.test(due) ? appointmentInstant(new Date(due + "T00:00:00Z"), /^\d{2}:\d{2}$/.test(str("time")) ? str("time") : "09:00") : null;
        const t = await prisma.crmTask.create({ data: { title: title.slice(0, 300), dueAt, leadId: str("leadId") || null, businessId: str("businessId") || null } });
        return NextResponse.json({ ok: true, id: t.id });
      }
      case "task.toggle": {
        await prisma.crmTask.update({ where: { id: str("id") }, data: { doneAt: b.done === false ? null : new Date() } });
        return NextResponse.json({ ok: true });
      }
      case "task.delete": {
        await prisma.crmTask.delete({ where: { id: str("id") } }).catch(() => {});
        return NextResponse.json({ ok: true });
      }
      case "rep.week": {
        // The days and hours of ONE week; the agent books only inside them.
        const repId = str("repId"), sunday = str("sunday");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(sunday)) return NextResponse.json({ error: "bad_week" }, { status: 400 });
        const end = addDaysISO(sunday, 7);
        const rows = Array.isArray(b.windows) ? (b.windows as { date: string; startTime: string; endTime: string }[]) : [];
        const valid = rows.filter(w => typeof w.date === "string" && w.date >= sunday && w.date < end && /^\d{2}:\d{2}$/.test(w.startTime) && /^\d{2}:\d{2}$/.test(w.endTime) && w.startTime < w.endTime);
        await prisma.repDateWindow.deleteMany({ where: { repId, date: { gte: new Date(sunday + "T00:00:00Z"), lt: new Date(end + "T00:00:00Z") } } });
        if (valid.length) await prisma.repDateWindow.createMany({ data: valid.map(w => ({ repId, date: new Date(w.date + "T00:00:00Z"), startTime: w.startTime, endTime: w.endTime })) });
        // "זה השבוע הרגיל שלי" → also the template the next weeks can start from.
        if (b.asTemplate === true) {
          await prisma.repWindow.deleteMany({ where: { repId } });
          if (valid.length) await prisma.repWindow.createMany({ data: valid.map(w => ({ repId, dayOfWeek: new Date(w.date + "T12:00:00Z").getUTCDay(), startTime: w.startTime, endTime: w.endTime })) });
        }
        return NextResponse.json({ ok: true });
      }
      case "rep.closeDay": {
        const repId = str("repId"), date = str("date");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "bad_date" }, { status: 400 });
        await prisma.repDateWindow.deleteMany({ where: { repId, date: new Date(date + "T00:00:00Z") } });
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
      // The Chator agent (10.10.2026): its knowledge (empty = the built-in default) and the version switch.
      case "salesAgent.knowledge": {
        const { setCrmText } = await import("@/lib/crm/core");
        const text = typeof b.knowledge === "string" ? b.knowledge.trim().slice(0, 20000) : "";
        return NextResponse.json({ ok: true, ...(await setCrmText("salesKnowledge", text)) });
      }
      case "salesAgent.v2": {
        const { setCrmText } = await import("@/lib/crm/core");
        return NextResponse.json({ ok: true, ...(await setCrmText("salesAgentV2", b.on === true ? "1" : "0")) });
      }
      // Approve a proposal = apply it to that business's agent; "base" is a change for every agent, done by hand.
      // The fix agent's queue (src/lib/agent/fix-queue.ts, 15.10.2026).
      case "improvement.queue": {
        const text = str("proposal").trim();
        const r = await prisma.agentImprovement.updateMany({ where: { id: str("id"), status: { in: ["pending", "approved"] } }, data: { status: "queued", ...(text ? { proposal: text } : {}) } });
        return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "כבר טופל" }, { status: 400 });
      }
      case "improvement.unqueue": {
        const r = await prisma.agentImprovement.updateMany({ where: { id: str("id"), status: "queued" }, data: { status: "pending" } });
        return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "הסוכן כבר התחיל" }, { status: 400 });
      }
      case "improvement.new": {
        const text = str("text").trim();
        if (!text) return NextResponse.json({ error: "מה לשפר?" }, { status: 400 });
        const { SUPER_ADMIN_BUSINESS_ID } = await import("@/lib/super-admin");
        await prisma.agentImprovement.create({ data: { businessId: str("businessId") || SUPER_ADMIN_BUSINESS_ID, source: "yair", kind: "base", title: text.split("\n")[0].slice(0, 80), proposal: text.slice(0, 4000), conversationId: str("conversationId") || null, status: "queued" } });
        return NextResponse.json({ ok: true });
      }
      case "improvement.publish": {
        const { publishFix } = await import("@/lib/agent/fix-queue");
        const r = await publishFix(str("id"), b.growthOk === true);
        return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 400 });
      }
      case "improvement.revise": {
        const { reviseFix } = await import("@/lib/agent/fix-queue");
        return (await reviseFix(str("id"), str("text"))) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "צריך לכתוב מה לתקן" }, { status: 400 });
      }
      // "היום": a row he closed (7 days) or moved to tomorrow (until 06:00).
      case "today.hide": {
        const key = str("key");
        if (!key) return NextResponse.json({ error: "חסר" }, { status: 400 });
        const until = b.tomorrow === true
          ? appointmentInstant(new Date(addDaysISO(getBusinessNow().date, 1) + "T00:00:00Z"), "06:00")
          : new Date(Date.now() + 7 * 86400_000);
        const cur = await todayHidden();
        const keep = Object.fromEntries(Object.entries(cur).filter(([, v]) => new Date(v).getTime() > Date.now()));
        keep[key] = until.toISOString();
        await prisma.crmSetting.upsert({ where: { key: "todayHidden" }, create: { key: "todayHidden", value: JSON.stringify(keep) }, update: { value: JSON.stringify(keep) } });
        return NextResponse.json({ ok: true });
      }
      case "improvement.reopen": {
        const r = await prisma.agentImprovement.updateMany({ where: { id: str("id"), status: "rejected" }, data: { status: "pending", decidedAt: null, decidedBy: null } });
        return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "כבר פתוח" }, { status: 400 });
      }
      case "improvement.reject": {
        const r = await prisma.agentImprovement.updateMany({ where: { id: str("id"), status: { in: ["pending", "queued", "question", "review"] } }, data: { status: "rejected", decidedAt: new Date(), decidedBy: "יאיר" } });
        return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "כבר טופל" }, { status: 400 });
      }
      case "improvement.revert": {
        const { revertFix } = await import("@/lib/agent/fix-queue");
        const r = await revertFix(str("id"));
        return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 400 });
      }
      case "improvement.decide": {
        const imp = await prisma.agentImprovement.findUnique({ where: { id: str("id") } });
        if (!imp || imp.status !== "pending") return NextResponse.json({ error: "כבר טופל" }, { status: 400 });
        const approve = b.approve === true;
        const text = str("proposal") || imp.proposal;
        let status = approve ? "applied" : "rejected";
        if (approve) {
          const { addFaq, appendBusinessRule } = await import("@/lib/agent/learn");
          if (imp.kind === "rule") await appendBusinessRule(imp.businessId, text, "review");
          else if (imp.kind === "faq") {
            const m = text.match(/ש:\s*([\s\S]*?)\s*ת:\s*([\s\S]*)/);
            if (!m) return NextResponse.json({ error: "הפורמט צריך להיות ש: ... ת: ..." }, { status: 400 });
            await addFaq(imp.businessId, m[1], m[2]);
          } else if (imp.kind === "setup") {
            const field = setupFieldsFor((await prisma.business.findUnique({ where: { id: imp.businessId }, select: { businessType: true } }))?.businessType).find(f => f.key === imp.targetKey);
            if (!field) return NextResponse.json({ error: "שאלת הגדרה לא מוכרת" }, { status: 400 });
            if (field.type === "choice" && field.options && !field.options.includes(text)) return NextResponse.json({ error: `הערך חייב להיות אחד מ: ${field.options.join(" / ")}` }, { status: 400 });
            await saveSetupAnswers(imp.businessId, { [field.key]: field.type === "bool" ? text === "כן" || text === "true" : text }, "review");
          } else status = "approved"; // base: for every agent, implemented by hand
        }
        await prisma.agentImprovement.update({ where: { id: imp.id }, data: { status, proposal: text, decidedAt: new Date(), decidedBy: "יאיר" } });
        if (status === "applied") { const { closeReports } = await import("@/lib/agent/fix-queue"); await closeReports(imp.id); }
        return NextResponse.json({ ok: true, status });
      }
      // Yair gave the referral's free month in Invoice4U (or takes it back).
      case "referral.applied": {
        await prisma.businessReferral.update({ where: { id: str("id") }, data: { appliedAt: b.applied === false ? null : new Date() } });
        return NextResponse.json({ ok: true });
      }
      // Yair answers a question of Chator's agent: to the customer, and maybe a rule.
      case "chatorQuestion.answer": {
        const { answerChatorQuestion } = await import("@/lib/agent/chator-support");
        const r = await answerChatorQuestion(str("id"), str("answer"), b.save !== false);
        return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
      }
      case "chatorQuestion.dismiss": {
        await prisma.chatorQuestion.updateMany({ where: { id: str("id"), status: "pending" }, data: { status: "dismissed", answeredAt: new Date() } });
        return NextResponse.json({ ok: true });
      }
      case "feedback.status": {
        const st = str("status");
        if (!["new", "in_review", "applied", "dismissed"].includes(st)) return NextResponse.json({ error: "bad_status" }, { status: 400 });
        await prisma.agentFeedback.update({ where: { id: str("id") }, data: { status: st, reviewNote: str("note") || null, reviewedAt: new Date() } });
        return NextResponse.json({ ok: true });
      }
      case "review.runNow": {
        const { runDailyReview, reviewBusiness } = await import("@/lib/agent/daily-review");
        if (str("businessId")) return NextResponse.json({ ok: true, proposals: await reviewBusiness(str("businessId"), new Date(), { sinceHours: Number(b.sinceHours) || 24 }) });
        return NextResponse.json({ ok: true, ...(await runDailyReview()) });
      }
      // Yair writes in a Chator chat himself: from Chator's number, and the agent steps back for 24h.
      case "quickReplies.save": {
        const { saveQuickReplies } = await import("@/lib/crm/quick-replies");
        return NextResponse.json({ ok: true, items: await saveQuickReplies(b.items) });
      }
      case "chat.send": {
        const { DEMO_BUSINESS_ID: DEMO } = await import("@/lib/demo-widget");
        const conv = await prisma.conversation.findFirst({ where: { id: str("id"), businessId: DEMO }, select: { phone: true } });
        const body = str("body");
        if (!conv || !body) return NextResponse.json({ error: "חסרה הודעה" }, { status: 400 });
        const { sendProactiveMessage } = await import("@/lib/messaging");
        // Instagram: past Meta's 24h window nothing can go out, so don't add a message that never left.
        if (conv.phone.startsWith("ig:")) {
          const { instagramWindowOpen, instagramSendError } = await import("@/lib/messaging/instagram");
          if (!(await instagramWindowOpen(DEMO, conv.phone))) return NextResponse.json({ error: instagramSendError("instagram_window_closed") }, { status: 409 });
        }
        const r = await sendProactiveMessage({ businessId: DEMO, customerPhone: conv.phone, body: body.slice(0, 4000), kind: "manual", escalate: true });
        if (r.ok) return NextResponse.json({ ok: true });
        if (conv.phone.startsWith("ig:")) {
          const { instagramSendError } = await import("@/lib/messaging/instagram");
          return NextResponse.json({ error: instagramSendError(r.error) }, { status: 502 });
        }
        return NextResponse.json({ error: "ההודעה לא יצאה. בדוק את חיבור הוואטסאפ של צ'אטור." }, { status: 502 });
      }
      // "✓ טופל" (13.10.2026, like the shop's chats): the red "waiting" goes away until he
      // writes again; the agent stays where it was.
      // A reply in the shop's requests thread; the shop sees it on /admin/requests.
      case "request.reply": {
        const businessId = str("businessId"), body = str("body");
        if (!businessId || !body) return NextResponse.json({ error: "missing" }, { status: 400 });
        const saved = await prisma.shopRequest.create({ data: { businessId, fromChator: true, authorName: "צ׳אטור", body: body.slice(0, 4000) } });
        const { centerNotify } = await import("@/lib/notify/center");
        // Awaited: a serverless function stops once it answers, and the notification was lost.
        await centerNotify({ businessId, kind: "account", title: "צ׳אטור ענו על הבקשה שלך", body: body.slice(0, 140), href: "/admin/requests" }).catch(() => {});
        return NextResponse.json({ ok: true, item: { id: saved.id, fromChator: true, author: saved.authorName, body: saved.body, audioUrl: null, audioSecs: null, at: saved.createdAt, done: false } });
      }
      case "request.draft": {
        const { draftRequestReply } = await import("@/lib/agent/request-draft");
        const r = await draftRequestReply(str("businessId"));
        return r.ok ? NextResponse.json({ ok: true, draft: r.draft }) : NextResponse.json({ error: r.error }, { status: 400 });
      }
      case "request.done": {
        const r = await prisma.shopRequest.findUnique({ where: { id: str("id") }, select: { doneAt: true } });
        if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
        await prisma.shopRequest.update({ where: { id: str("id") }, data: { doneAt: r.doneAt ? null : new Date() } });
        return NextResponse.json({ ok: true, done: !r.doneAt });
      }
      case "chat.handled": {
        const { DEMO_BUSINESS_ID: DEMO } = await import("@/lib/demo-widget");
        await prisma.conversation.updateMany({ where: { id: str("id"), businessId: DEMO }, data: b.handled === false ? { handledAt: null } : { handledAt: new Date(), lastReadAt: new Date() } });
        return NextResponse.json({ ok: true });
      }
      case "chat.agent": {
        const { DEMO_BUSINESS_ID: DEMO } = await import("@/lib/demo-widget");
        await prisma.conversation.updateMany({ where: { id: str("id"), businessId: DEMO }, data: { escalatedAt: b.on === true ? null : new Date(), status: b.on === true ? "active" : "escalated" } });
        return NextResponse.json({ ok: true });
      }
      case "settings.update": {
        const patch: Partial<CrmSettings> = {};
        for (const k of ["callMinutes", "breakMinutes", "horizonDays", "minNoticeMinutes", "infraCostIls", "packMessagesQty", "packMessagesPrice", "packAiIls", "packAiPrice", "packMarketingQty", "packMarketingPrice"] as const) if (typeof b[k] === "number") patch[k] = b[k] as number;
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
      case "plans.save": {
        const rows = Array.isArray(b.plans) ? (b.plans as Record<string, unknown>[]) : [];
        for (const p of rows) {
          const key = typeof p.key === "string" ? p.key : "";
          const num = (k: string) => Math.max(0, Math.round(Number(p[k]) || 0));
          if (!key || typeof p.name !== "string" || !p.name.trim()) continue;
          await prisma.crmPlan.update({ where: { key }, data: { name: p.name.trim().slice(0, 40), apptsCap: num("apptsCap"), messages: num("messages"), aiBudgetIls: num("aiBudgetIls"), priceIls: num("priceIls"), updatedAt: new Date() } }).catch(() => {});
        }
        return NextResponse.json({ ok: true, plans: await getPlans() });
      }
      case "customer.plan": {
        const ok = await assignPlan(str("id"), str("planKey"));
        return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "מסלול לא נמצא" }, { status: 400 });
      }
      case "customer.pack": {
        const kind = str("kind") as PackKind;
        if (!["messages", "ai", "marketing"].includes(kind)) return NextResponse.json({ error: "bad_kind" }, { status: 400 });
        const r = await addPack(str("id"), kind);
        if (!r) return NextResponse.json({ error: "not_found" }, { status: 404 });
        await prisma.leadNote.create({ data: { businessId: str("id"), author: "מסלול", body: `נוספה חבילת ${kind === "messages" ? `${r.qty} הודעות` : kind === "ai" ? `סוכן (${r.qty} ₪)` : `${r.qty} הודעות שיווק`} ב-${r.priceIls} ₪` } });
        return NextResponse.json({ ok: true, ...r });
      }
      case "invoice.create": {
        const amount = Number(b.amount);
        const issued = str("issuedAt");
        if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(issued)) return NextResponse.json({ error: "סכום ותאריך חובה" }, { status: 400 });
        const pdf = str("pdfUrl");
        if (pdf && !/^https:\/\//.test(pdf)) return NextResponse.json({ error: "קישור החשבונית חייב להתחיל ב-https" }, { status: 400 });
        const inv = await prisma.crmInvoice.create({ data: { businessId: str("id"), number: str("number") || null, issuedAt: new Date(issued + "T12:00:00Z"), amountIls: amount, status: str("status") === "unpaid" ? "unpaid" : "paid", pdfUrl: pdf || null, provider: "manual" } });
        return NextResponse.json({ ok: true, id: inv.id });
      }
      case "invoice.delete": {
        await prisma.crmInvoice.deleteMany({ where: { id: str("invoiceId"), provider: "manual" } });
        return NextResponse.json({ ok: true });
      }
      case "invoice.send": {
        const inv = await prisma.crmInvoice.findUnique({ where: { id: str("invoiceId") } });
        if (!inv?.pdfUrl) return NextResponse.json({ error: "לחשבונית הזאת אין קישור" }, { status: 400 });
        const biz = await prisma.business.findUnique({ where: { id: inv.businessId }, select: { phone: true, settings: true, name: true } });
        const to = biz ? ownerPhoneOf(biz) : null;
        if (!to) return NextResponse.json({ error: "אין טלפון לבעל העסק" }, { status: 400 });
        const body = `החשבונית שלך מצ'אטור${inv.number ? ` מספר ${inv.number}` : ""} על ${inv.amountIls.toLocaleString("he-IL")} ₪:\n${inv.pdfUrl}`;
        const phone = normalizeIsraeliPhone(to);
        const r = await sendMessage({ businessId: DEMO_BUSINESS_ID, customerPhone: phone, kind: "manual", body });
        if (!r.ok) return NextResponse.json({ error: r.error || "send_failed" }, { status: 502 });
        await mirrorToConversation(DEMO_BUSINESS_ID, phone, body, "admin");
        await prisma.crmInvoice.update({ where: { id: inv.id }, data: { sentAt: new Date() } });
        return NextResponse.json({ ok: true });
      }
      case "customer.payLink": {
        if (!billingConfigured()) return NextResponse.json({ error: "Invoice4U עוד לא מחובר: צריך להפעיל הוראות קבע ולחדש את המפתח" }, { status: 400 });
        const biz = await prisma.business.findUnique({ where: { id: str("id") }, select: { id: true, name: true, phone: true, settings: true, monthlyPrice: true } });
        if (!biz) return NextResponse.json({ error: "not_found" }, { status: 404 });
        const email = str("email");
        if (email) { const st = biz.settings ? JSON.parse(biz.settings) : {}; st.billingEmail = email; await prisma.business.update({ where: { id: biz.id }, data: { settings: JSON.stringify(st) } }); }
        const url = await createStandingOrderLink({
          origin: req.nextUrl.origin, businessId: biz.id, fullName: biz.name, email, phone: ownerPhoneOf(biz) ?? "",
          amountIls: biz.monthlyPrice ?? 287, itemName: "Chator מנוי חודשי", qa: b.qa === true,
        });
        return NextResponse.json({ ok: true, url });
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
        if (key === "platformNotes") { await saveSetupAnswers(str("id"), { platformNotes: str("value") }, "crm"); return NextResponse.json({ ok: true }); }
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

