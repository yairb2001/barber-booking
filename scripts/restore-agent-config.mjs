// Restores AgentConfig.systemPrompt (+ agentName + faqs) from a backup file
// produced by backup-agent-config.mjs. Verifies the DB matches the backup's
// checksum AFTER writing, so a silent partial/mangled write is caught
// immediately instead of discovered later in production traffic.
//
// FAQ restore is destructive-and-recreate (delete all current AgentFAQ rows
// for this config, recreate from the backup) since AgentFAQ rows have no
// natural stable key across edits — acceptable because we only ever restore
// to a state that was itself backed up moments before a change.
//
//   node --env-file=.env scripts/restore-agent-config.mjs <backup-file.json>
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import fs from "node:fs";

const prisma = new PrismaClient();
const backupPath = process.argv[2];
if (!backupPath) {
  console.error("Usage: node --env-file=.env scripts/restore-agent-config.mjs <backup-file.json>");
  process.exit(1);
}

function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// MUST match joinFaqs() in backup-agent-config.mjs exactly, or a correct
// restore will show a false checksum mismatch. Written as plain string
// concatenation (not a template literal) after a prior version's template
// literal silently picked up stray control-byte separators that were
// invisible in every editor/terminal view but broke every checksum.
function joinFaqs(faqs) {
  return faqs.map(function (f) { return f.question + " " + f.answer; }).join("|");
}

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  const { businessId, agentConfigId, agentName, systemPrompt, greetingMsg, faqs, checksums } = snapshot;

  // Backup file integrity check BEFORE touching the DB — a corrupted backup
  // must never be trusted just because someone points us at it.
  if (systemPrompt && sha256(systemPrompt) !== checksums.systemPrompt) {
    throw new Error("Backup file's systemPrompt does not match its own recorded checksum — refusing to restore from a corrupted backup.");
  }

  console.log(`Restoring AgentConfig ${agentConfigId} (business ${businessId}) from backup taken ${snapshot.backedUpAt}...`);

  await prisma.$transaction(async (tx) => {
    await tx.agentConfig.update({
      where: { id: agentConfigId },
      data: { agentName, systemPrompt, greetingMsg },
    });
    await tx.agentFAQ.deleteMany({ where: { agentConfigId } });
    if (faqs.length) {
      await tx.agentFAQ.createMany({
        data: faqs.map(f => ({ agentConfigId, question: f.question, answer: f.answer, sortOrder: f.sortOrder })),
      });
    }
  });

  // Verify: re-read from the DB and confirm it matches the backup exactly —
  // don't just trust that the write succeeded because Prisma didn't throw.
  const after = await prisma.agentConfig.findUnique({
    where: { id: agentConfigId },
    include: { faqs: { orderBy: { sortOrder: "asc" } } },
  });
  const afterSystemPromptHash = after.systemPrompt ? sha256(after.systemPrompt) : null;
  const afterFaqs = after.faqs.map(function (f) { return { question: f.question, answer: f.answer }; });
  const afterFaqsHash = sha256(joinFaqs(afterFaqs));

  const systemPromptOk = afterSystemPromptHash === checksums.systemPrompt;
  const faqsOk = afterFaqsHash === checksums.faqsJoined;

  console.log(`  systemPrompt restored: ${systemPromptOk ? "OK (checksum matches)" : "MISMATCH"}`);
  console.log(`  faqs restored: ${faqsOk ? "OK (checksum matches)" : "MISMATCH"}`);

  await prisma.$disconnect();

  if (!systemPromptOk || !faqsOk) {
    console.error("\n RESTORE VERIFICATION FAILED — DB does not match the backup. Do not assume production is back to the pre-change state.");
    process.exit(1);
  }
  console.log("\nRestore verified byte-for-byte against the backup.");
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
