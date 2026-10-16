import { prisma } from "@/lib/prisma";

/**
 * Who performs a service (owner, 16.10.2026: "מי מהצוות עושה את השירות הזה",
 * chosen on the service form). Makes the StaffService links match `staffIds`
 * exactly — within this business's staff only. A link that already exists is
 * kept as is (its custom price/duration survive); an unticked one is removed.
 */
export async function syncServiceStaff(serviceId: string, businessId: string, staffIds: unknown): Promise<void> {
  if (!Array.isArray(staffIds)) return;
  const staff = await prisma.staff.findMany({ where: { businessId }, select: { id: true } });
  const valid = new Set(staff.map(s => s.id));
  const want = new Set(staffIds.filter((x): x is string => typeof x === "string" && valid.has(x)));
  const have = await prisma.staffService.findMany({ where: { serviceId }, select: { staffId: true } });
  const haveSet = new Set(have.map(h => h.staffId));
  const remove = Array.from(haveSet).filter(id => valid.has(id) && !want.has(id));
  const add = Array.from(want).filter(id => !haveSet.has(id));
  if (remove.length) await prisma.staffService.deleteMany({ where: { serviceId, staffId: { in: remove } } });
  if (add.length) await prisma.staffService.createMany({ data: add.map(staffId => ({ staffId, serviceId })), skipDuplicates: true });
}
