// READ-ONLY inspection of the services catalog and per-barber linkage.
// No writes. Run: node --env-file=.env scripts/inspect-services.mjs
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function norm(s) {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

const businesses = await prisma.business.findMany({ select: { id: true, name: true } });

for (const biz of businesses) {
  const [staff, services, staffServices] = await Promise.all([
    prisma.staff.findMany({
      where: { businessId: biz.id, isAvailable: true },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.service.findMany({
      where: { businessId: biz.id },
      select: { id: true, name: true, price: true, durationMinutes: true, isVisible: true, ownerStaffId: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.staffService.findMany({
      where: { staff: { businessId: biz.id } },
      select: { staffId: true, serviceId: true, customPrice: true, customDuration: true, customName: true, customNote: true },
    }),
  ]);

  if (!staff.length && !services.length) continue;

  const shared = services.filter(s => s.ownerStaffId === null);
  const owned = services.filter(s => s.ownerStaffId !== null);
  const visibleShared = shared.filter(s => s.isVisible);
  const staffName = Object.fromEntries(staff.map(s => [s.id, s.name]));
  const ssSet = new Set(staffServices.map(ss => `${ss.staffId}::${ss.serviceId}`));

  console.log("\n==================================================");
  console.log(`BUSINESS: ${biz.name} (${biz.id})`);
  console.log(`  barbers (available): ${staff.length} — ${staff.map(s => s.name).join(", ")}`);
  console.log(`  services total: ${services.length}  | shared(ownerStaffId=null): ${shared.length} (visible: ${visibleShared.length})  | barber-owned: ${owned.length}`);

  // Duplicate shared service names (the "duplicate catalog" problem).
  const byName = {};
  for (const s of shared) (byName[norm(s.name)] ??= []).push(s);
  const dups = Object.entries(byName).filter(([, arr]) => arr.length > 1);
  if (dups.length) {
    console.log(`  ⚠️ DUPLICATE shared service names: ${dups.length}`);
    for (const [n, arr] of dups) console.log(`     "${arr[0].name}" ×${arr.length} (ids: ${arr.map(a => a.id.slice(0,8)).join(", ")})`);
  } else {
    console.log(`  duplicate shared names: none`);
  }

  // Barber-owned services — what each barber invented privately. Count their
  // appointments: a service WITH appointments cannot be hard-deleted (FK on
  // Appointment.serviceId), so those need hiding/remapping instead of delete.
  const sharedNameSet = new Set(shared.map(s => norm(s.name)));
  if (owned.length) {
    console.log(`  barber-owned services (candidates to delete):`);
    for (const s of owned) {
      const apptCount = await prisma.appointment.count({ where: { serviceId: s.id } });
      const dupOfShared = sharedNameSet.has(norm(s.name)) ? "  [same name as a SHARED service]" : "";
      const safety = apptCount > 0 ? `⚠️ has ${apptCount} appointments — cannot hard-delete` : "safe to delete (0 appointments)";
      console.log(`     "${s.name}" — ${s.price}₪/${s.durationMinutes}min, visible:${s.isVisible}  → owner: ${staffName[s.ownerStaffId] ?? s.ownerStaffId}  | ${safety}${dupOfShared}`);
    }
  }

  // Coverage: for each barber × each VISIBLE shared service, is a StaffService row present?
  let missing = 0, present = 0, withOverride = 0;
  const missingByBarber = {};
  for (const b of staff) {
    for (const s of visibleShared) {
      const key = `${b.id}::${s.id}`;
      if (ssSet.has(key)) {
        present++;
        const ss = staffServices.find(x => x.staffId === b.id && x.serviceId === s.id);
        if (ss && (ss.customPrice !== null || ss.customDuration !== null || ss.customName !== null || ss.customNote !== null)) withOverride++;
      } else {
        missing++;
        missingByBarber[b.name] = (missingByBarber[b.name] ?? 0) + 1;
      }
    }
  }
  console.log(`  COVERAGE (barbers × visible shared services = ${staff.length * visibleShared.length}):`);
  console.log(`     linked: ${present}  (of which with custom override: ${withOverride})`);
  console.log(`     MISSING links (barber doesn't offer a shared service): ${missing}`);
  if (missing) {
    for (const [name, n] of Object.entries(missingByBarber)) console.log(`        ${name}: missing ${n}`);
  }
}

await prisma.$disconnect();
console.log("\n(read-only — nothing was modified)");
