import { prisma } from "@/lib/prisma";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** The one real id that differs from `id` in at most 3 characters; a correct or a foreign id → null. */
export function nearestId(id: string, real: string[]): string | null {
  if (!UUID.test(id) || real.includes(id)) return null;
  const near = real.filter(r => r.length === id.length && Array.from(r).filter((c, i) => c !== id[i]).length <= 3);
  return near.length === 1 ? near[0] : null;
}

/** The model copied a treatment's id with one letter wrong, the calendar found no such treatment, and the customer was
 *  told the day is full (25.11.2026). An id one slip away from a real one is that one. */
export async function withRealIds<T extends { serviceId?: unknown; staffId?: unknown }>(businessId: string, input: T): Promise<T> {
  const out = { ...input };
  if (typeof out.serviceId === "string" && UUID.test(out.serviceId)) {
    const id = nearestId(out.serviceId, (await prisma.service.findMany({ where: { businessId }, select: { id: true } })).map(s => s.id));
    if (id) out.serviceId = id;
  }
  if (typeof out.staffId === "string" && UUID.test(out.staffId)) {
    const id = nearestId(out.staffId, (await prisma.staff.findMany({ where: { businessId }, select: { id: true } })).map(s => s.id));
    if (id) out.staffId = id;
  }
  return out;
}
