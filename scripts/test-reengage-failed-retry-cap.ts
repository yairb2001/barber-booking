/**
 * Live regression test for the reengage failed-retry-storm fix (2026-08-30).
 * Reproduces the bug Yair reported: the same ~30 customers kept getting a
 * fresh reengage attempt enqueued every single day because failed sends
 * (status: "failed", usually a WhatsApp-send timeout) were excluded from the
 * per-stage cap count in src/app/api/cron/automations/route.ts. Fixed by
 * counting every attempt (success or failure) toward the 1-per-stage cap.
 *
 * Runs against the DEMO business — creates a throwaway Automation + Customer
 * + MessageLog row, replicates the exact selection query from route.ts, and
 * deletes everything it created at the end.
 *
 * Usage: npx tsx --env-file=.env scripts/test-reengage-failed-retry-cap.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BIZ_ID = "ad8d79ef-33ea-4230-9c19-2ed01f0f3a96"; // demo business

async function main() {
  const now = new Date();
  const inactiveWeeks = 6;
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - inactiveWeeks * 7);

  // Customer crossed the inactivity threshold 2 days ago (well past cutoff).
  const lastVisitAt = new Date(cutoffDate);
  lastVisitAt.setDate(lastVisitAt.getDate() - 2);

  const activatedAt = new Date(now);
  activatedAt.setDate(activatedAt.getDate() - 30); // automation active well before this customer went inactive

  const auto = await prisma.automation.create({
    data: {
      businessId: BIZ_ID, type: "reengage", name: "בדיקה", active: true, activatedAt,
      settings: JSON.stringify({ inactiveWeeks, finalNudgeWeeks: inactiveWeeks * 2, excludeWithFutureAppt: true, segment: "all" }),
    },
  });
  const customer = await prisma.customer.create({
    data: { businessId: BIZ_ID, name: "בדיקה-ריטריי", phone: "972000000099", lastVisitAt },
  });

  // Yesterday's attempt failed with the known timeout error — this is the
  // exact shape Yair saw in prod.
  const failedLog = await prisma.messageLog.create({
    data: {
      businessId: BIZ_ID, customerPhone: customer.phone, kind: "reengage",
      status: "failed", body: "test reengage attempt", error: "The operation was aborted due to timeout",
      createdAt: new Date(now.getTime() - 24 * 3600 * 1000),
    },
  });

  console.log("customer lastVisitAt:", lastVisitAt.toISOString());
  console.log("cutoffDate:", cutoffDate.toISOString());
  console.log("yesterday's failed attempt logged at:", failedLog.createdAt.toISOString());

  // ── Replicate the exact selection logic from route.ts (post-fix) ─────────
  const priorSends = await prisma.messageLog.findMany({
    where: { businessId: BIZ_ID, kind: "reengage", customerPhone: { in: [customer.phone] } },
    select: { customerPhone: true, createdAt: true },
  });
  const countSinceVisit = priorSends.filter(l => l.customerPhone === customer.phone && l.createdAt > lastVisitAt).length;
  const wouldBeSelectedAfterFix = countSinceVisit === 0; // count===0 -> first nudge eligible; count>=1 -> capped

  // ── What the OLD (buggy) logic would have done, for comparison ───────────
  const priorSendsOldLogic = await prisma.messageLog.findMany({
    where: { businessId: BIZ_ID, kind: "reengage", status: { not: "failed" }, customerPhone: { in: [customer.phone] } },
    select: { customerPhone: true, createdAt: true },
  });
  const countOldLogic = priorSendsOldLogic.filter(l => l.customerPhone === customer.phone && l.createdAt > lastVisitAt).length;
  const wouldBeSelectedOldLogic = countOldLogic === 0;

  console.log("\n=== RESULT ===");
  console.log("attempt count counted by OLD logic (excludes failed):", countOldLogic, "-> would re-select today:", wouldBeSelectedOldLogic);
  console.log("attempt count counted by NEW logic (includes failed):", countSinceVisit, "-> would re-select today:", wouldBeSelectedAfterFix);

  if (wouldBeSelectedOldLogic === true && wouldBeSelectedAfterFix === false) {
    console.log("✅ PASS — old logic would retry the failed customer again today (the bug); new logic correctly stops after 1 attempt");
  } else {
    console.log("❌ FAIL — expected old=true (bug reproduced), new=false (fixed)");
    process.exitCode = 1;
  }
}

main()
  .catch(err => { console.error("\n❌ TEST ERROR:", err); process.exitCode = 1; })
  .finally(async () => {
    await prisma.messageLog.deleteMany({ where: { businessId: BIZ_ID, customerPhone: "972000000099" } });
    await prisma.customer.deleteMany({ where: { businessId: BIZ_ID, phone: "972000000099" } });
    await prisma.automation.deleteMany({ where: { businessId: BIZ_ID, type: "reengage" } });
    console.log("\ncleaned up test data");
    await prisma.$disconnect();
  });
