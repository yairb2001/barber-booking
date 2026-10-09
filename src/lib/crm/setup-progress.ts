/**
 * Setup tracking for the CRM's operations view (spec: "תפעול והגדרת הסוכן", 10.10.2026).
 *
 * Eight steps, every one derived from the data — nobody ticks anything by hand.
 * The first time a step is seen done, its moment is stored in
 * Business.settings.setupProgress so "stuck since" survives later edits.
 *
 * Stuck = 24h without progress → a help message to the owner (automation
 * "setup_stuck"); 48h → "needs handling" in the CRM + an alert to the rep
 * ("setup_stuck_rep"). Both are CRM automations, so their text is editable
 * and they stay OFF until Yair turns them on.
 */
import { prisma } from "@/lib/prisma";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { missingCoreFields, type SetupConfig } from "@/lib/agent/setup-fields";

export const SETUP_STEPS = [
  { key: "password", label: "נכנס והגדיר סיסמה" },
  { key: "business", label: "פרטי העסק ושעות" },
  { key: "team", label: "צוות" },
  { key: "services", label: "שירותים" },
  { key: "agent", label: "הגדרות הסוכן וניסיון" },
  { key: "whatsapp", label: "וואטסאפ מחובר" },
  { key: "agent_on", label: "הסוכן הופעל" },
  { key: "live", label: "תור ראשון דרך הסוכן" },
] as const;
export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];

export type SetupState = {
  businessId: string;
  steps: { key: SetupStepKey; label: string; done: boolean; at: string | null }[];
  doneCount: number;
  current: { key: SetupStepKey; label: string } | null; // first step not done
  lastProgressAt: string;
  stuckHours: number; // 0 when done or moving
  isLive: boolean;
  missingAgentFields: string[];
};

const parse = (raw: string | null | undefined): Record<string, unknown> => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };

export async function computeSetup(opts: { businessIds?: string[]; persist?: boolean } = {}): Promise<SetupState[]> {
  const bizs = await prisma.business.findMany({
    where: { id: { notIn: [DEMO_BUSINESS_ID, SUPER_ADMIN_BUSINESS_ID] }, ...(opts.businessIds ? { id: { in: opts.businessIds } } : {}) },
    select: { id: true, createdAt: true, passwordHash: true, settings: true, whatsappStatus: true, businessType: true },
  });
  if (!bizs.length) return [];
  const ids = bizs.map(b => b.id);
  const [staff, schedules, services, agents, sandbox, agentAppts] = await Promise.all([
    prisma.staff.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, isActive: true }, _count: { _all: true } }),
    prisma.staffSchedule.findMany({ where: { isWorking: true, staff: { businessId: { in: ids } } }, select: { staff: { select: { businessId: true } } } }),
    prisma.service.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, isVisible: true }, _count: { _all: true } }),
    prisma.agentConfig.findMany({ where: { businessId: { in: ids } }, select: { businessId: true, isEnabled: true, setupConfig: true } }),
    prisma.agentUsage.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, kind: "sandbox" }, _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, source: "agent" }, _min: { createdAt: true } }),
  ]);
  const now = Date.now();
  const out: SetupState[] = [];
  for (const b of bizs) {
    const s = parse(b.settings);
    const onboarding = (s.onboarding ?? {}) as { doneSteps?: string[] };
    const doneSteps = Array.isArray(onboarding.doneSteps) ? onboarding.doneSteps : [];
    const stored = (s.setupProgress ?? {}) as Record<string, string>;
    const agent = agents.find(a => a.businessId === b.id);
    const setup = parse(agent?.setupConfig) as SetupConfig;
    const missing = missingCoreFields(setup, b.businessType).map(f => f.key);
    const firstAgentAppt = agentAppts.find(a => a.businessId === b.id)?._min.createdAt ?? null;
    const done: Record<SetupStepKey, boolean> = {
      password: !!b.passwordHash,
      business: doneSteps.includes("business") || schedules.some(x => x.staff.businessId === b.id),
      team: (staff.find(x => x.businessId === b.id)?._count._all ?? 0) > 0,
      services: (services.find(x => x.businessId === b.id)?._count._all ?? 0) > 0,
      agent: missing.length === 0 && ((sandbox.find(x => x.businessId === b.id)?._count._all ?? 0) > 0 || doneSteps.includes("agent")),
      whatsapp: b.whatsappStatus === "connected",
      agent_on: !!agent?.isEnabled,
      live: !!firstAgentAppt,
    };
    const nowIso = new Date().toISOString();
    let changed = false;
    const at: Record<string, string> = { ...stored };
    for (const st of SETUP_STEPS) {
      if (done[st.key] && !at[st.key]) { at[st.key] = st.key === "live" && firstAgentAppt ? firstAgentAppt.toISOString() : nowIso; changed = true; }
    }
    if (changed && opts.persist) {
      await prisma.business.update({ where: { id: b.id }, data: { settings: JSON.stringify({ ...s, setupProgress: at }) } }).catch(() => {});
    }
    const steps = SETUP_STEPS.map(st => ({ key: st.key, label: st.label, done: done[st.key], at: done[st.key] ? at[st.key] ?? null : null }));
    const doneCount = steps.filter(x => x.done).length;
    const current = steps.find(x => !x.done) ?? null;
    const times = steps.filter(x => x.at).map(x => new Date(x.at!).getTime());
    const last = Math.max(b.createdAt.getTime(), ...times);
    const isLive = done.live;
    out.push({
      businessId: b.id, steps, doneCount, current: current ? { key: current.key, label: current.label } : null,
      lastProgressAt: new Date(last).toISOString(),
      stuckHours: isLive || !current ? 0 : Math.floor((now - last) / 3600_000),
      isLive, missingAgentFields: missing,
    });
  }
  return out;
}

/** Hourly: persist progress and start the stuck-setup automations (each once per stuck episode). */
export async function scanStuckSetups(): Promise<void> {
  const { startAutomation } = await import("@/lib/crm/automations");
  const states = await computeSetup({ persist: true });
  const autos = await prisma.crmAutomation.findMany({ where: { key: { in: ["setup_stuck", "setup_stuck_rep"] }, enabled: true }, select: { id: true, key: true } });
  if (!autos.length) return;
  for (const st of states) {
    if (!st.current || st.isLive) continue;
    for (const a of autos) {
      const threshold = a.key === "setup_stuck" ? 24 : 48;
      if (st.stuckHours < threshold) continue;
      // Once per episode: no run of this automation since the last progress.
      const ran = await prisma.crmAutomationRun.count({ where: { automationId: a.id, businessId: st.businessId, startedAt: { gte: new Date(st.lastProgressAt) } } });
      if (ran) continue;
      await startAutomation(a.key as "setup_stuck" | "setup_stuck_rep", { businessId: st.businessId, context: { stepLabel: st.current.label } });
    }
  }
}
