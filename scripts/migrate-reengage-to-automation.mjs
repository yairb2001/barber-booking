// One-off migration: for any Business still using the legacy Business.reengageEnabled
// toggle (whose cron was never actually wired up correctly in production before this
// fix), ensure an equivalent Automation(type="reengage") row exists so behavior carries
// over to the now-scheduled /api/cron/automations. Idempotent — skips businesses that
// already have a reengage Automation row.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const businesses = await prisma.business.findMany({
    where: { reengageEnabled: true },
    select: { id: true, name: true, reengageWeeks: true, reengageTemplate: true },
  });

  console.log(`Found ${businesses.length} business(es) with reengageEnabled=true`);

  for (const biz of businesses) {
    const existing = await prisma.automation.findFirst({
      where: { businessId: biz.id, type: "reengage" },
    });

    if (existing) {
      console.log(`- ${biz.name} (${biz.id}): already has an Automation row (${existing.id}, active=${existing.active}) — skipping`);
      continue;
    }

    const settings = JSON.stringify({
      inactiveWeeks: biz.reengageWeeks,
      excludeWithFutureAppt: true,
      segment: "all",
    });

    const created = await prisma.automation.create({
      data: {
        businessId: biz.id,
        type: "reengage",
        name: "החזרת לקוחות לא פעילים",
        active: true,
        activatedAt: new Date(),
        settings,
        template: biz.reengageTemplate || null,
      },
    });

    console.log(`- ${biz.name} (${biz.id}): created Automation ${created.id} (migrated from legacy fields)`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
