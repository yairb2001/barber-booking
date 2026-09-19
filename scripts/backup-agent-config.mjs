// Backs up the DB-stored AgentConfig row (systemPrompt, faqs, agentName —
// the actual live prompt content, NOT anything in git) for a business, with
// a checksum for verifying a later restore matches exactly.
//
// Why this exists: the compression lever for the LLM cost-reduction project
// (2026-09-19) changes `AgentConfig.systemPrompt` in the DB directly — a
// content change, not a code change, so `git revert` does nothing for it.
// Required (Yair via Tzachi) before any such change: an explicit backup with
// a restore procedure tested once for real. See restore-agent-config.mjs.
//
//   node --env-file=.env scripts/backup-agent-config.mjs <businessId>
//
// Writes prompt-backups/agent-config-<businessId>-<ISO timestamp>.json
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, "..", "prompt-backups");

const prisma = new PrismaClient();
const businessId = process.argv[2];
if (!businessId) {
  console.error("Usage: node --env-file=.env scripts/backup-agent-config.mjs <businessId>");
  process.exit(1);
}

function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function joinFaqs(faqs) {
  return faqs.map(function (f) { return f.question + " " + f.answer; }).join("|");
}

async function main() {
  const cfg = await prisma.agentConfig.findFirst({
    where: { businessId: businessId },
    include: { faqs: { orderBy: { sortOrder: "asc" } } },
  });
  if (!cfg) {
    console.error("No AgentConfig found for business " + businessId);
    process.exit(1);
  }

  // Materialize the FAQ array ONCE and derive both the persisted field and
  // its checksum from this same local variable, not two separate reads of
  // cfg.faqs.
  const faqs = cfg.faqs.map(function (f) {
    return { question: f.question, answer: f.answer, sortOrder: f.sortOrder };
  });

  const snapshot = {
    businessId: businessId,
    backedUpAt: new Date().toISOString(),
    agentConfigId: cfg.id,
    agentName: cfg.agentName,
    systemPrompt: cfg.systemPrompt,
    greetingMsg: cfg.greetingMsg,
    faqs: faqs,
    checksums: {
      systemPrompt: cfg.systemPrompt ? sha256(cfg.systemPrompt) : null,
      faqsJoined: sha256(joinFaqs(faqs)),
    },
  };

  const ts = snapshot.backedUpAt.replace(/[:.]/g, "-");
  const outPath = path.join(BACKUP_DIR, "agent-config-" + businessId + "-" + ts + ".json");
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

  console.log("Backed up AgentConfig for " + businessId + ":");
  console.log("  systemPrompt: " + (cfg.systemPrompt ? cfg.systemPrompt.length : 0) + " chars, sha256=" + snapshot.checksums.systemPrompt);
  console.log("  faqs: " + cfg.faqs.length + " rows, sha256=" + snapshot.checksums.faqsJoined);
  console.log("  -> " + outPath);

  await prisma.$disconnect();
}

main().catch(async function (err) {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
