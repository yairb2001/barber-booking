// READ-ONLY: diagnose why barber "ישראל" quick-slots have misaligned gaps.
// Prints his weekly schedule start times + the service durations quick-slots would use.
// Run: node --env-file=.env scripts/diag-israel-slots.mjs
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];

const staff = await prisma.staff.findMany({
  where: { name: { contains: "ישרא" } },
  select: { id: true, name: true, businessId: true, settings: true },
});

for (const s of staff) {
  console.log("\n==================================================");
  console.log(`BARBER: ${s.name} (${s.id.slice(0,8)})  biz=${s.businessId.slice(0,8)}`);

  // Weekly schedule
  const sched = await prisma.staffSchedule.findMany({
    where: { staffId: s.id },
    orderBy: { dayOfWeek: "asc" },
  });
  console.log("  משמרות שבועיות (שעת התחלה של כל בלוק):");
  for (const d of sched) {
    let slots = [];
    try { slots = JSON.parse(d.slots || "[]"); } catch {}
    const starts = slots.map(x => x.start).join(", ");
    console.log(`     ${DAYS[d.dayOfWeek]}: working=${d.isWorking}  slots=[${starts}]`);
  }

  // Which services quick-slots would consider (visible shared, ordered by sortOrder),
  // and this barber's effective durations.
  const visibleServices = await prisma.service.findMany({
    where: { businessId: s.businessId, isVisible: true, ownerStaffId: null },
    select: { id: true, name: true, durationMinutes: true },
    orderBy: { sortOrder: "asc" },
  });
  const ss = await prisma.staffService.findMany({
    where: { staffId: s.id },
    select: { serviceId: true, customDuration: true },
  });
  const offered = new Set(ss.map(x => x.serviceId));
  const first = visibleServices.find(v => offered.has(v.id));
  console.log("  שירות ראשון שהתורים המהירים בוחרים:");
  if (first) {
    const ov = ss.find(x => x.serviceId === first.id);
    const eff = ov?.customDuration || first.durationMinutes;
    console.log(`     "${first.name}"  base=${first.durationMinutes}min  customDuration=${ov?.customDuration ?? "—"}  → משך אפקטיבי=${eff}min`);
  } else {
    console.log("     (לא נמצא שירות מוצע)");
  }
  console.log("  כל השירותים שהוא מציע + משך אפקטיבי:");
  for (const v of visibleServices) {
    if (!offered.has(v.id)) continue;
    const ov = ss.find(x => x.serviceId === v.id);
    const eff = ov?.customDuration || v.durationMinutes;
    console.log(`     "${v.name}": base=${v.durationMinutes}min custom=${ov?.customDuration ?? "—"} → ${eff}min`);
  }
}

await prisma.$disconnect();
console.log("\n(read-only — nothing was modified)");
