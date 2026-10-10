/**
 * The one way a shop's agent setup answers change (AgentConfig.setupConfig):
 * merge, save, and keep a history row so any version can be restored.
 * Used by the owner's agent screen, the setup wizard, the owner agent's
 * save_setup_field tool and the CRM.
 */
import { prisma } from "@/lib/prisma";
import type { SetupConfig } from "@/lib/agent/setup-fields";

const LONG_KEYS = new Set(["businessRules", "platformNotes", "staffRules", "styleSamples"]);

export type SetupAuthor = "owner" | "wizard" | "owner_agent" | "crm" | "review";

export async function saveSetupAnswers(businessId: string, patch: Record<string, unknown>, author: SetupAuthor): Promise<SetupConfig> {
  const cur = await prisma.agentConfig.findUnique({ where: { businessId }, select: { setupConfig: true } });
  let existing: SetupConfig = {};
  try { existing = cur?.setupConfig ? JSON.parse(cur.setupConfig) : {}; } catch { existing = {}; }
  const next: SetupConfig = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    // Lists the shop keeps adding to (rules, notes) get more room than a single answer.
    if (typeof v === "string") { const t = v.trim().slice(0, LONG_KEYS.has(k) ? 4000 : 1500); if (t) next[k] = t; else delete next[k]; }
    else if (typeof v === "boolean") next[k] = v;
    else if (v === null) delete next[k];
  }
  if (JSON.stringify(next) === JSON.stringify(existing)) return existing;
  const json = JSON.stringify(next);
  await prisma.agentConfig.upsert({ where: { businessId }, create: { businessId, setupConfig: json }, update: { setupConfig: json } });
  await prisma.agentSetupHistory.create({ data: { businessId, config: json, author } }).catch(() => {});
  return next;
}

/** Put an older version back (it becomes the newest history row). */
export async function restoreSetupVersion(businessId: string, historyId: string, author: SetupAuthor): Promise<boolean> {
  const h = await prisma.agentSetupHistory.findUnique({ where: { id: historyId } });
  if (!h || h.businessId !== businessId) return false;
  await prisma.agentConfig.upsert({ where: { businessId }, create: { businessId, setupConfig: h.config }, update: { setupConfig: h.config } });
  await prisma.agentSetupHistory.create({ data: { businessId, config: h.config, author } });
  return true;
}
