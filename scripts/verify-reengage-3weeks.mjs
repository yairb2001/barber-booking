// Read-only verification: for every reengage MessageLog sent to Dominant's real
// business, check whether the customer's last actual past appointment (any
// non-cancelled status, date in the past relative to the send) was really
// >= the automation's configured inactiveWeeks threshold before the send.
//
// Also reports customer.lastVisitAt (the field the cron itself filters on) so we
// can see whether it's in sync with real appointment history.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const auto = await prisma.automation.findFirst({
    where: { type: "reengage", active: true },
    include: { business: true },
  });

  if (!auto) {
    console.log("No active reengage automation found.");
    return;
  }

  let settings;
  try { settings = JSON.parse(auto.settings || "{}"); } catch { settings = {}; }
  const inactiveWeeks = settings.inactiveWeeks ?? 6;
  console.log(`Business: ${auto.business.name} (${auto.businessId})`);
  console.log(`Configured inactiveWeeks: ${inactiveWeeks} (${inactiveWeeks * 7} days)`);
  console.log("---");

  const logs = await prisma.messageLog.findMany({
    where: { businessId: auto.businessId, kind: "reengage" },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${logs.length} reengage MessageLog entries total.\n`);

  let ok = 0, bad = 0, noHistory = 0;
  const badRows = [];

  for (const log of logs) {
    const customer = await prisma.customer.findFirst({
      where: { businessId: auto.businessId, phone: log.customerPhone },
    });

    // Last real past appointment (any status except cancelled ones), strictly
    // before the message send time — this is the actual ground truth for
    // "when did this customer last have a visit scheduled/happen".
    const lastAppt = await prisma.appointment.findFirst({
      where: {
        businessId: auto.businessId,
        status: { notIn: ["cancelled_by_staff", "cancelled_by_customer"] },
        customer: { phone: log.customerPhone },
        date: { lt: log.createdAt },
      },
      orderBy: { date: "desc" },
    });

    const sentAt = log.createdAt;
    const requiredCutoff = new Date(sentAt);
    requiredCutoff.setDate(requiredCutoff.getDate() - inactiveWeeks * 7);

    if (!lastAppt) {
      noHistory++;
      continue;
    }

    const gapDays = Math.round((sentAt - lastAppt.date) / (1000 * 60 * 60 * 24));
    const isValid = lastAppt.date <= requiredCutoff;

    if (isValid) {
      ok++;
    } else {
      bad++;
      badRows.push({
        name: customer?.name ?? log.customerPhone,
        phone: log.customerPhone,
        sentAt: sentAt.toISOString(),
        lastApptDate: lastAppt.date.toISOString(),
        lastApptStatus: lastAppt.status,
        gapDays,
        customerLastVisitAt: customer?.lastVisitAt?.toISOString() ?? null,
      });
    }
  }

  if (badRows.length) {
    console.log("INVALID sends (real last appointment was too recent — false positive):\n");
    for (const r of badRows) {
      console.log(`✗ ${r.name} (${r.phone})`);
      console.log(`    sent:            ${r.sentAt}`);
      console.log(`    last real appt:  ${r.lastApptDate} (status=${r.lastApptStatus}, only ${r.gapDays}d before send, needed >= ${inactiveWeeks * 7}d)`);
      console.log(`    customer.lastVisitAt in DB: ${r.customerLastVisitAt}`);
      console.log("");
    }
  }

  console.log("---");
  console.log(`Valid (real last appointment >= ${inactiveWeeks}w before send): ${ok}`);
  console.log(`INVALID (sent too early — real false positive): ${bad}`);
  console.log(`No prior real appointment found at all (never had one, or genuinely long gone): ${noHistory}`);
}

main().finally(() => prisma.$disconnect());
