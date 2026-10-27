/**
 * The WhatsApp funnel at work (25.10.2026; rules and settings: src/lib/crm/wa-funnel.ts).
 *  - runWaFunnel: from the drip job every 5 minutes, the next follow-up of each quiet chat.
 *  - waFunnelView: the CRM tab "וואטסאפ", everyone by stage with his next automatic step.
 *  - waToLead / waSetNotRelevant: Yair moving someone by hand.
 */
import { prisma } from "@/lib/prisma";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { normalizeIsraeliPhone, phoneVariants } from "@/lib/messaging/phone";
import { parseSalesState, salesReply, saveSalesState, createLead, repName, demoFreeSlot, SIGNUP_URL, LANDING_URL, type SalesState } from "@/lib/agent/sales-agent";
import { isPhoneLikeName } from "@/lib/agent/followup-shared";
import { hiddenChatPhones } from "@/lib/crm/json-settings";
import { chatorCustomerPhones } from "@/lib/agent/chator-support";
import { attributionFromOpening } from "@/lib/lead-attribution";
import { getFunnelConfig, planContact, fillFunnelText, okHours, whenLabel, WA_STAGES, WA_STAGE_LABEL, WA_EXIT_LABEL, type ContactFacts, type FunnelConfig, type WaExit, type WaStage } from "@/lib/crm/wa-funnel";

type Contact = {
  id: string;
  phone: string;
  whatsappName: string | null;
  lastMessageAt: Date | null;
  state: SalesState;
  facts: ContactFacts;
  firstText: string | null;
  leadId: string | null;
};

/**
 * The number is also the academy's WhatsApp (0555081866): a student asking about a course
 * gets no Chator follow-ups (Yair still decides on a list of students; this is the floor).
 */
const ACADEMY_RE = /קורס|אקדמי|סדנ[אה]|מחזור|תלמיד/;

const firstName = (c: { state: SalesState; whatsappName: string | null }): string | null => {
  const raw = c.state.fullName || (c.whatsappName && !isPhoneLikeName(c.whatsappName) ? c.whatsappName : "");
  const first = raw.trim().split(/\s+/)[0] || "";
  // Only plain Hebrew or English letters: a WhatsApp name in a fancy font reads oddly in a message (27.10.2026).
  return /^[\u05D0-\u05EAA-Za-z'\u05F3]{2,20}$/.test(first) ? first : null;
};

/** Every sales chat on Chator's number that moved in the last `sinceDays` days, with what the funnel needs. */
async function loadContacts(now: Date, opts: { sinceDays: number; phone?: string }): Promise<Contact[]> {
  const convs = await prisma.conversation.findMany({
    where: { businessId: DEMO_BUSINESS_ID, agentType: { not: "owner" }, salesState: { not: null }, lastMessageAt: { gte: new Date(now.getTime() - opts.sinceDays * 86_400_000) }, ...(opts.phone ? { phone: opts.phone } : {}) },
    orderBy: { lastMessageAt: "desc" }, take: 400,
    select: { id: true, phone: true, whatsappName: true, salesState: true, escalatedAt: true, lastMessageAt: true },
  });
  // Hidden chats (people Yair knows) get no follow-ups and are not counted (27.10.2026).
  const hidden = await hiddenChatPhones();
  const kept = convs.filter(c => !hidden.has(c.phone));
  if (!kept.length) return [];
  const ids = kept.map(c => c.id);
  const [lasts, firsts, customers] = await Promise.all([
    prisma.conversationMessage.groupBy({ by: ["conversationId", "role"], where: { conversationId: { in: ids }, role: { in: ["user", "assistant"] } }, _max: { createdAt: true } }),
    prisma.conversationMessage.findMany({ where: { conversationId: { in: ids }, role: "user" }, orderBy: { createdAt: "asc" }, take: 5000, select: { conversationId: true, content: true } }),
    chatorCustomerPhones(),
  ]);
  const last = new Map<string, { user?: Date; ours?: Date }>();
  for (const g of lasts) {
    const e = last.get(g.conversationId) ?? {};
    if (g.role === "user") e.user = g._max.createdAt ?? undefined; else e.ours = g._max.createdAt ?? undefined;
    last.set(g.conversationId, e);
  }
  const first = new Map<string, string>();
  const academy = new Set<string>();
  for (const m of firsts) {
    if (!first.has(m.conversationId)) first.set(m.conversationId, m.content);
    if (ACADEMY_RE.test(m.content)) academy.add(m.conversationId);
  }
  const phones = kept.filter(c => !c.phone.startsWith("ig:")).flatMap(c => phoneVariants(c.phone));
  const leads = phones.length ? await prisma.lead.findMany({ where: { phone: { in: phones } }, orderBy: { createdAt: "desc" }, select: { id: true, phone: true, optedOut: true } }) : [];
  const leadOf = new Map<string, { id: string; optedOut: boolean }>();
  for (const l of leads) { const n = normalizeIsraeliPhone(l.phone); if (n && !leadOf.has(n)) leadOf.set(n, l); }

  const out: Contact[] = [];
  for (const c of kept) {
    const state = parseSalesState(c.salesState);
    if (!state) continue;
    const ig = c.phone.startsWith("ig:");
    const lead = ig ? null : leadOf.get(c.phone) ?? null;
    const l = last.get(c.id) ?? {};
    const facts: ContactFacts = {
      state, ig,
      lastUserAt: l.user ?? null,
      lastOurAt: l.ours ?? null,
      lastIsOurs: !!l.ours && (!l.user || l.ours.getTime() >= l.user.getTime()),
      isLead: !!lead,
      optedOut: !!lead?.optedOut,
      signedUp: !ig && customers.has(c.phone),
      escalated: !!c.escalatedAt && now.getTime() - c.escalatedAt.getTime() < 24 * 3600_000,
      academy: academy.has(c.id),
    };
    out.push({ id: c.id, phone: c.phone, whatsappName: c.whatsappName, lastMessageAt: c.lastMessageAt, state, facts, firstText: first.get(c.id) ?? null, leadId: lead?.id ?? (state.leadId && state.leadId !== "sandbox" ? state.leadId : null) });
  }
  return out;
}

/** The follow-up as he will get it: variables filled, and the "נציג" line when the text has none. */
async function compose(text: string, c: Contact, cfg: FunnelConfig): Promise<string> {
  const filled = fillFunnelText(text, {
    name: firstName(c),
    landing: LANDING_URL,
    signup: SIGNUP_URL,
    slot: text.includes("{שעה פנויה}") ? await demoFreeSlot() : null,
    rep: await repName(null),
  });
  return cfg.repLineFollowups && cfg.repLine && !filled.includes("נציג") ? `${filled}\n\n${cfg.repLine}` : filled;
}

const MAX_PER_RUN = 20;

/**
 * One pass: each quiet chat whose next step is due gets it (one per chat, inside the
 * sending hours). The step is marked sent before it goes out, so a failure never sends it
 * twice. Sandbox numbers (972000…) only in a dry run, which sends and saves nothing.
 */
export async function runWaFunnel(now: Date = new Date(), dryRun?: { phone: string; out: { phone: string; key: string; text: string }[] }): Promise<number> {
  const cfg = await getFunnelConfig();
  const use = dryRun ? { ...cfg, enabled: true, enabledAt: null } : cfg;
  if (!dryRun && (!cfg.enabled || !okHours(now, cfg.hours))) return 0;
  const contacts = await loadContacts(now, { sinceDays: cfg.notRelevantDays + 10, phone: dryRun?.phone });
  let sent = 0;
  for (const c of contacts) {
    if (sent >= MAX_PER_RUN) break;
    if (!dryRun && c.phone.startsWith("972000")) continue;
    const plan = planContact(c.facts, use, now);
    if (plan.exit || !plan.next || plan.next.sendAt.getTime() > now.getTime()) continue;
    const text = await compose(plan.next.step.text, c, use);
    if (!text) continue;
    if (dryRun) { dryRun.out.push({ phone: c.phone, key: plan.next.key, text }); sent++; continue; }
    // He wrote in the meantime → his chat is live again; the agent is on it.
    const newer = await prisma.conversationMessage.findFirst({ where: { conversationId: c.id, role: "user", createdAt: { gt: c.facts.lastUserAt ?? new Date(0) } }, select: { id: true } });
    if (newer) continue;
    const stamp = now.toISOString();
    const skipped = Object.fromEntries((plan.next.skip ?? []).map(k => [k, stamp]));
    await saveSalesState(c.id, { ...c.state, wa: { ...c.state.wa, sent: { ...c.state.wa?.sent, ...skipped, [plan.next.key]: stamp } } });
    await salesReply(c.id, c.phone, [text]);
    sent++;
  }
  return sent;
}

// ─── The CRM tab ─────────────────────────────────────────────────────────────

function sourceLabel(c: Contact): string {
  if (c.facts.ig) return "אינסטגרם";
  const a = attributionFromOpening(c.firstText);
  if (a) { try { const j = JSON.parse(a) as { source?: string }; if (j.source === "meta") return "מודעה"; if (j.source === "site") return "כפתור הדמו"; } catch { /* ignore */ } }
  if (c.state.source === "landing") return "כפתור הדמו";
  return "רגיל";
}

export type WaContactRow = {
  id: string; name: string; phone: string; ig: boolean; source: string;
  stage: WaStage; exit: WaExit | null; exitBy: string | null;
  lastUserAt: string | null; lastAt: string | null;
  next: { when: string; text: string } | null;
  notRelevantWhen: string | null;
  waiting: boolean; academy: boolean; escalated: boolean; leadId: string | null;
};

export async function waFunnelView(now: Date = new Date()) {
  const saved = await getFunnelConfig();
  const cfg = saved.enabled ? saved : { ...saved, enabledAt: now.toISOString() };
  const contacts = (await loadContacts(now, { sinceDays: 45 })).filter(c => !c.phone.startsWith("972000"));
  const rows: WaContactRow[] = contacts.map(c => {
    const plan = planContact(c.facts, cfg, now);
    const t = c.state.wa ?? {};
    const by = plan.exit === "lead" ? (t.outBy === "manual" ? "הועבר ידנית" : t.outBy === "keyword" ? "ביקש נציג או פרטים" : t.outBy === "agent" ? "ביקש בן אדם" : "השאיר שם לשיחה")
      : plan.exit === "not_relevant" ? (t.out === "not_relevant" && t.outBy === "manual" ? "סומן ידנית" : c.state.mode === "declined" ? "אמר שלא" : `${cfg.notRelevantDays} ימים בלי תגובה`)
      : null;
    return {
      id: c.id,
      name: c.state.fullName || (c.whatsappName && !isPhoneLikeName(c.whatsappName) ? c.whatsappName : "") || (c.facts.ig ? "פונה מאינסטגרם" : c.phone.replace(/^972/, "0")),
      phone: c.facts.ig ? "" : c.phone.replace(/^972/, "0"),
      ig: c.facts.ig,
      source: sourceLabel(c),
      stage: plan.stage,
      exit: plan.exit,
      exitBy: by,
      lastUserAt: c.facts.lastUserAt?.toISOString() ?? null,
      lastAt: c.lastMessageAt?.toISOString() ?? null,
      next: plan.next ? { when: whenLabel(plan.next.sendAt, now), text: fillFunnelText(plan.next.step.text, { name: firstName(c), landing: "(דף הנחיתה)", signup: "(קישור הרשמה)", slot: "(שעה פנויה)", rep: "יאיר" }) } : null,
      notRelevantWhen: !plan.exit && !plan.next && plan.notRelevantAt ? whenLabel(plan.notRelevantAt, now) : null,
      waiting: !c.facts.lastIsOurs,
      academy: !!c.facts.academy,
      escalated: c.facts.escalated,
      leadId: c.leadId,
    };
  });
  return {
    enabled: saved.enabled,
    stages: WA_STAGES.map(k => ({ key: k, label: WA_STAGE_LABEL[k] })),
    exits: (["lead", "signed_up", "not_relevant"] as const).map(k => ({ key: k, label: WA_EXIT_LABEL[k] })),
    contacts: rows,
  };
}

// ─── By hand ─────────────────────────────────────────────────────────────────

async function loadChat(conversationId: string) {
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, businessId: DEMO_BUSINESS_ID }, select: { id: true, phone: true, whatsappName: true, salesState: true } });
  const state = parseSalesState(conv?.salesState);
  if (!conv || !state) throw new Error("השיחה לא נמצאה");
  return { conv, state };
}

/** "העבר לליד": to the leads tab, stage "new". */
export async function waToLead(conversationId: string): Promise<{ leadId: string }> {
  const { conv, state } = await loadChat(conversationId);
  const ig = conv.phone.startsWith("ig:");
  const phone = ig ? state.contactPhone : conv.phone;
  if (!phone) throw new Error("באינסטגרם אין לנו את המספר שלו. אפשר להעביר לליד אחרי שייתן מספר.");
  const name = state.fullName || (conv.whatsappName && !isPhoneLikeName(conv.whatsappName) ? conv.whatsappName.trim() : "");
  const leadId = await createLead({ phone, conversationId: conv.id, fullName: name, businessName: state.businessName ?? "", businessType: null, source: ig ? "instagram" : state.source ?? null, stage: "new", quiet: true });
  await saveSalesState(conv.id, { ...state, mode: state.mode === "demo" ? "lead_demo" : state.mode === "lead_demo" ? "lead_demo" : "lead", leadId, fullName: name || state.fullName, wa: { ...state.wa, out: "lead", outAt: new Date().toISOString(), outBy: "manual" } });
  return { leadId };
}

/** "לא רלוונטי" (on) or back to his stage (off). A new message from him brings him back anyway. */
export async function waSetNotRelevant(conversationId: string, on: boolean): Promise<void> {
  const { conv, state } = await loadChat(conversationId);
  const wa = { ...state.wa, out: on ? ("not_relevant" as const) : undefined, outAt: on ? new Date().toISOString() : undefined, outBy: on ? ("manual" as const) : undefined };
  await saveSalesState(conv.id, { ...state, mode: !on && state.mode === "declined" ? "sales" : state.mode, wa });
}
