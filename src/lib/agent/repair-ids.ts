import { prisma } from "@/lib/prisma";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHORT = /^[0-9a-f]{8}$/i;
const ID_KEYS = new Set(["serviceId", "staffId"]);

/** The one real id that differs from `id` in at most 3 characters; a correct or a foreign id → null. */
export function nearestId(id: string, real: string[]): string | null {
  if (!UUID.test(id) || real.includes(id)) return null;
  const near = real.filter(r => r.length === id.length && Array.from(r).filter((c, i) => c !== id[i]).length <= 3);
  return near.length === 1 ? near[0] : null;
}

/** The catalog in the prompt shows each id by its first 8 characters (27.11.2026: 36 characters × every staff member
 *  and treatment kept shops past the prompt cap). An id that shares those 8 with another one stays whole. */
export function catalogIds(ids: string[]): (id: string) => string {
  const count = new Map<string, number>();
  for (const id of ids) count.set(id.slice(0, 8), (count.get(id.slice(0, 8)) ?? 0) + 1);
  return id => (count.get(id.slice(0, 8)) === 1 ? id.slice(0, 8) : id);
}

/** The real id for what the model passed: the short catalog id, or a whole id one slip away from a real one. */
export function realId(id: string, real: string[]): string | null {
  if (SHORT.test(id)) { const m = real.filter(r => r.startsWith(id.toLowerCase())); return m.length === 1 ? m[0] : null; }
  return nearestId(id, real);
}

/** Every serviceId / staffId in a tool's input, at any depth (a visit's treatments, the others in a booking), made real.
 *  The model copied a treatment's id with one letter wrong, the calendar found no such treatment, and the customer was
 *  told the day is full (25.11.2026). */
export async function withRealIds<T extends object>(businessId: string, input: T): Promise<T> {
  let services: string[] | null = null, staff: string[] | null = null;
  const fix = async (key: string, v: string) => {
    if (!SHORT.test(v) && !UUID.test(v)) return v;
    const real = key === "serviceId"
      ? (services ??= (await prisma.service.findMany({ where: { businessId }, select: { id: true } })).map(s => s.id))
      : (staff ??= (await prisma.staff.findMany({ where: { businessId }, select: { id: true } })).map(s => s.id));
    return realId(v, real) ?? v;
  };
  const walk = async (x: unknown): Promise<unknown> => {
    if (Array.isArray(x)) return Promise.all(x.map(walk));
    if (!x || typeof x !== "object") return x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) out[k] = ID_KEYS.has(k) && typeof v === "string" ? await fix(k, v) : await walk(v);
    return out;
  };
  return (await walk(input)) as T;
}
