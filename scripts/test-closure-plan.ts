/**
 * READ-ONLY smoke test for the closure planner against real data.
 * Picks the root business, finds the next date where some barber has ≥2 active
 * appointments, and prints the plan for closing that barber's day. Writes nothing.
 * Run: npx tsx --env-file=.env scripts/test-closure-plan.ts [YYYY-MM-DD] [staffId]
 */
import { prisma } from "../src/lib/prisma";
import { planClosure } from "../src/lib/closures/plan";
import { getBusinessNow, addDaysISO } from "../src/lib/utils";

async function main() {
  const biz = await prisma.business.findFirst({ where: { slug: "dominant" }, select: { id: true, name: true } });
  if (!biz) throw new Error("root business not found");
  let date = process.argv[2], staffId = process.argv[3];
  if (!date || !staffId) {
    const today = getBusinessNow().date;
    for (let d = 0; d < 14 && !date; d++) {
      const ds = addDaysISO(today, d);
      const g = await prisma.appointment.groupBy({
        by: ["staffId"], where: { businessId: biz.id, date: new Date(ds + "T00:00:00.000Z"), status: { in: ["pending", "confirmed"] } },
        _count: { _all: true },
      });
      const best = g.sort((a, b) => b._count._all - a._count._all)[0];
      if (best && best._count._all >= 2) { date = ds; staffId = best.staffId; }
    }
  }
  if (!date || !staffId) { console.log("no day with ≥2 active appointments in the next 14 days"); return; }
  const t0 = Date.now();
  const plan = await planClosure({ businessId: biz.id, staffId, date });
  console.log(`\n${biz.name} · ${plan.staffName} · ${date}${plan.isToday ? " (today)" : ""} · ${Date.now() - t0}ms`);
  console.log(`gate: ${plan.gate.ok ? "OK" : "BLOCKED"} · needed=${plan.gate.needed} distinct=${plan.gate.distinctSlots} withoutOption=${plan.gate.withoutOption.length}`);
  for (const d of plan.displaced) {
    const loy = d.loyalty.share === null ? "new" : `${Math.round(d.loyalty.share * 100)}%`;
    const opts = d.options.map(o => `${o.date} ${o.startTime}${o.sameStaff ? "" : " @" + o.staffName}`).join(" | ") || "—";
    console.log(`  ${d.startTime} ${d.customer.name.padEnd(18)} ${d.service.name.padEnd(14)} loyalty=${loy.padEnd(4)} → ${opts}${d.blockedByLoyalty ? "  (blocked by 70% rule)" : ""}`);
  }
  if (!plan.gate.ok) console.log("suggestions:", JSON.stringify(plan.suggestions));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
