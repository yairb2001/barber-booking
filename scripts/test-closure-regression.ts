/** DOMINANT regression (read-only): a day with 0 appointments → empty plan, gate OK, nothing to do. */
import { prisma } from "../src/lib/prisma";
import { planClosure } from "../src/lib/closures/plan";
import { addDaysISO, getBusinessNow } from "../src/lib/utils";
async function main() {
  const biz = await prisma.business.findFirst({ where: { slug: "dominant" }, select: { id: true } });
  const staff = await prisma.staff.findMany({ where: { businessId: biz!.id, isAvailable: true }, select: { id: true, name: true } });
  const today = getBusinessNow().date;
  let found: { iso: string; staff: { id: string; name: string } } | null = null;
  for (let d = 1; d < 60 && !found; d++) {
    const iso = addDaysISO(today, d);
    for (const s of staff) {
      const n = await prisma.appointment.count({ where: { businessId: biz!.id, staffId: s.id, date: new Date(iso + "T00:00:00.000Z"), status: { in: ["pending", "confirmed"] } } });
      if (n === 0) { found = { iso, staff: s }; break; }
    }
  }
  if (!found) { console.log("no empty day found in 60 days"); return; }
  const t0 = Date.now();
  const plan = await planClosure({ businessId: biz!.id, staffId: found.staff.id, date: found.iso });
  const okEmpty = plan.displaced.length === 0 && plan.gate.ok && plan.gate.needed === 0;
  console.log(`${found.staff.name} · ${found.iso} · ${Date.now() - t0}ms → displaced=${plan.displaced.length} gate.ok=${plan.gate.ok} → ${okEmpty ? "PASS (behaves exactly like today: plain close)" : "FAIL"}`);
  const wrote = await prisma.calendarClosure.count({ where: { businessId: biz!.id } });
  console.log(`DOMINANT calendar_closures rows: ${wrote} (must be 0 — nothing written)`);
  await prisma.$disconnect();
  process.exit(okEmpty && wrote === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
