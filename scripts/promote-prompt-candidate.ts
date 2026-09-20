/**
 * Stage B promotion / rollback (docs/PLAN-COST.md).
 *
 *   npx tsx --env-file=.env scripts/promote-prompt-candidate.ts promote   # backup live prompt → write candidate → agentPromptV2=true
 *   npx tsx --env-file=.env scripts/promote-prompt-candidate.ts rollback <backup.json>   # restore prompt + agentPromptV2=false
 *   npx tsx --env-file=.env scripts/promote-prompt-candidate.ts status
 *
 * Only the DB side lives here (AgentConfig.systemPrompt + Business.settings).
 * The trimmed tool descriptions are code: promotion also means the commit that
 * makes AGENT_TOOLS use the trimmed wording (see prompt-candidates.ts).
 * Backups go to prompt-backups/ with a sha256 so a restore can be verified.
 */
import { prisma } from "../src/lib/prisma";
import { DOMINANT_CANDIDATE_PROMPT } from "../src/lib/agent/prompt-candidates";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const SLUG = "dominant";
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const biz = await prisma.business.findFirst({ where: { slug: SLUG }, select: { id: true, name: true, settings: true } });
  if (!biz) throw new Error("business not found");
  const cfg = await prisma.agentConfig.findUnique({ where: { businessId: biz.id } });
  if (!cfg) throw new Error("agent config not found");
  const settings = biz.settings ? JSON.parse(biz.settings) : {};

  if (cmd === "status") {
    const isCandidate = (cfg.systemPrompt ?? "") === DOMINANT_CANDIDATE_PROMPT;
    console.log(`${biz.name}: prompt ${cfg.systemPrompt?.length ?? 0} chars (${isCandidate ? "= CANDIDATE" : "live/other"}, sha ${sha(cfg.systemPrompt ?? "").slice(0, 12)}) · agentPromptV2=${settings.agentPromptV2 === true} · agentPromptV3=${settings.agentPromptV3 === true} · agentPromptV4=${settings.agentPromptV4 === true}`);
    return;
  }

  // promote-v3: same as promote, plus settings.agentPromptV3 (stage C: propose_booking
  // tool set, code-confirmed bookings). The DB prompt written is whatever
  // DOMINANT_CANDIDATE_PROMPT currently is (v3 text since 20.9.2026).
  if (cmd === "promote" || cmd === "promote-v3" || cmd === "promote-v4") {
    const dir = path.join(process.cwd(), "prompt-backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `dominant-prompt-pre-stageB-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    const backup = { businessId: biz.id, agentConfigId: cfg.id, systemPrompt: cfg.systemPrompt, settings: biz.settings, sha256: sha(cfg.systemPrompt ?? ""), takenAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(backup, null, 1));
    await prisma.$transaction([
      prisma.agentConfig.update({ where: { id: cfg.id }, data: { systemPrompt: DOMINANT_CANDIDATE_PROMPT } }),
      prisma.business.update({ where: { id: biz.id }, data: { settings: JSON.stringify({ ...settings, agentPromptV2: true, ...(cmd === "promote-v3" || cmd === "promote-v4" ? { agentPromptV3: true } : {}), ...(cmd === "promote-v4" ? { agentPromptV4: true } : {}) }) } }),
    ]);
    const after = await prisma.agentConfig.findUnique({ where: { id: cfg.id }, select: { systemPrompt: true } });
    if (sha(after?.systemPrompt ?? "") !== sha(DOMINANT_CANDIDATE_PROMPT)) throw new Error("verification failed — prompt in DB does not match the candidate");
    console.log(`promoted. backup: ${file} (${backup.systemPrompt?.length} chars) → live prompt ${DOMINANT_CANDIDATE_PROMPT.length} chars, agentPromptV2=true${cmd === "promote-v3" || cmd === "promote-v4" ? ", agentPromptV3=true" : ""}${cmd === "promote-v4" ? ", agentPromptV4=true" : ""}`);
    return;
  }

  if (cmd === "rollback") {
    if (!arg) throw new Error("rollback needs the backup file");
    const backup = JSON.parse(fs.readFileSync(arg, "utf8"));
    if (backup.businessId !== biz.id) throw new Error("backup belongs to another business");
    if (sha(backup.systemPrompt ?? "") !== backup.sha256) throw new Error("backup file corrupted (sha mismatch)");
    const prev = backup.settings ? JSON.parse(backup.settings) : {};
    const restoredSettings = { ...settings, agentPromptV2: prev.agentPromptV2 === true, agentPromptV3: prev.agentPromptV3 === true, agentPromptV4: prev.agentPromptV4 === true };
    await prisma.$transaction([
      prisma.agentConfig.update({ where: { id: cfg.id }, data: { systemPrompt: backup.systemPrompt } }),
      prisma.business.update({ where: { id: biz.id }, data: { settings: JSON.stringify(restoredSettings) } }),
    ]);
    const after = await prisma.agentConfig.findUnique({ where: { id: cfg.id }, select: { systemPrompt: true } });
    if (sha(after?.systemPrompt ?? "") !== backup.sha256) throw new Error("verification failed after restore");
    console.log(`rolled back to ${backup.takenAt} (${backup.systemPrompt?.length} chars), agentPromptV2=false`);
    return;
  }
  throw new Error("usage: promote | promote-v3 | promote-v4 | rollback <file> | status");
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
