// READ-ONLY: show shared services + the full per-barber override matrix.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const biz = await prisma.business.findFirst({ where: { name: "dominant" }, select: { id: true } });

const [staff, shared, ss] = await Promise.all([
  prisma.staff.findMany({ where: { businessId: biz.id, isAvailable: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
  prisma.service.findMany({ where: { businessId: biz.id, ownerStaffId: null }, select: { id: true, name: true, price: true, durationMinutes: true, isVisible: true }, orderBy: { sortOrder: "asc" } }),
  prisma.staffService.findMany({ where: { staff: { businessId: biz.id } } }),
]);

console.log("SHARED services (the uniform catalog):");
for (const s of shared) console.log(`  [${s.id.slice(0,8)}] "${s.name}" — base ${s.price}₪/${s.durationMinutes}min  visible:${s.isVisible}`);

console.log("\nPer-barber linkage to shared services (✓=linked, override values if any):");
for (const b of staff) {
  console.log(`  ${b.name}`);
  for (const s of shared) {
    const row = ss.find(x => x.staffId === b.id && x.serviceId === s.id);
    if (!row) { console.log(`     ✗ "${s.name}" — NOT linked`); continue; }
    const ov = [];
    if (row.customPrice !== null) ov.push(`price ${row.customPrice}₪`);
    if (row.customDuration !== null) ov.push(`dur ${row.customDuration}min`);
    if (row.customName !== null) ov.push(`name "${row.customName}"`);
    if (row.customNote !== null) ov.push(`note "${row.customNote}"`);
    console.log(`     ✓ "${s.name}"${ov.length ? " — override: " + ov.join(", ") : " — (base values)"}`);
  }
}

await prisma.$disconnect();
console.log("\n(read-only)");
