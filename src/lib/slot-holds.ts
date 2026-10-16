// Soft holds on free slots (SlotHold). Three holders today:
//   • the calendar-closure wizard — alternatives offered to a displaced customer
//     (1 hour, keyed by customerId + the SwapProposal id);
//   • the agent — the one slot it just proposed and is waiting for a "כן" on
//     (5 minutes, holderKey "phone:972…");
//   • the booking site — a visitor on the confirm screen (5 minutes, renewed
//     while the screen is open, holderKey "web:<token>", released on leaving).
// While a hold is live the slot is busy for everyone else on every booking
// surface (public booking pages, quick slots, the agent) and shows as a 🔒
// block in the admin calendar. The holder himself still sees it as free.
import { prisma } from "@/lib/prisma";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { bookedBusy } from "@/lib/availability/shape";

/** How long a closure alternative stays locked for the customer it was offered to. */
export const CLOSURE_HOLD_MINUTES = 60;
/** How long a proposed slot (agent) / a confirm screen (site) keeps the slot — owner's spec, 6.10.2026. */
export const SHORT_HOLD_MINUTES = 5;

export type HoldRow = { staffId: string; date: Date; startTime: string; endTime: string };

export const holderKeyForPhone = (phone: string) => `phone:${normalizeIsraeliPhone(phone)}`;
export const holderKeyForWeb = (token: string) => `web:${token}`;
/** SlotHold.proposalId of a waitlist cascade: "wl:<cascadeId>". */
export const WL_PREFIX = "wl:";

/** Unexpired holds for these barbers in [from, to] (UTC-midnight dates, inclusive),
 *  minus the ones that belong to the caller (his own holds must not block him). */
export async function activeHolds(scope: { staffIds: string[]; from: Date; to: Date; exemptCustomerId?: string | null; exemptHolderKeys?: (string | null | undefined)[] }): Promise<HoldRow[]> {
  if (!scope.staffIds.length) return [];
  const keys = (scope.exemptHolderKeys ?? []).filter((k): k is string => !!k);
  const not: Record<string, unknown>[] = [];
  if (scope.exemptCustomerId) not.push({ customerId: scope.exemptCustomerId });
  if (keys.length) not.push({ holderKey: { in: keys } });
  // Waitlist in turns: everyone already messaged keeps his right after his turn
  // (owner, 15.10.2026) — the holds of one cascade never block each other.
  if (keys.length || scope.exemptCustomerId) {
    const mine = await prisma.slotHold.findMany({
      where: { proposalId: { startsWith: WL_PREFIX }, OR: [...(keys.length ? [{ holderKey: { in: keys } }] : []), ...(scope.exemptCustomerId ? [{ customerId: scope.exemptCustomerId }] : [])] },
      select: { proposalId: true },
    });
    const groups = Array.from(new Set(mine.map(m => m.proposalId).filter((x): x is string => !!x)));
    if (groups.length) not.push({ proposalId: { in: groups } });
  }
  return prisma.slotHold.findMany({
    where: {
      staffId: { in: scope.staffIds },
      date: { gte: scope.from, lte: scope.to },
      expiresAt: { gt: new Date() },
      ...(not.length ? { NOT: not } : {}),
    },
    select: { staffId: true, date: true, startTime: true, endTime: true },
  });
}

/** Appointment rows + live holds, so slot generation treats a held slot as booked.
 *  Hold rows carry staffId/date/startTime/endTime — a superset of what the slot
 *  endpoints select — so they flow through the same grouping code. */
export async function withActiveHolds<T>(appts: Promise<T[]>, scope: { staffIds: string[]; from: Date; to: Date; exemptHolderKeys?: (string | null | undefined)[] }): Promise<T[]> {
  const [a, h] = await Promise.all([appts, activeHolds(scope).catch(() => [] as HoldRow[])]);
  return h.length ? [...a, ...(h as unknown as T[])] : a;
}

/** Hold one slot for one holder. A holder has at most one short hold at a time
 *  (a new proposal / a new confirm screen replaces the previous one). */
export async function holdSlot(p: { businessId: string; staffId: string; dateISO: string; startTime: string; endTime: string; holderKey: string; customerId?: string | null; proposalId?: string | null; minutes?: number }): Promise<void> {
  let expiresAt = new Date(Date.now() + (p.minutes ?? SHORT_HOLD_MINUTES) * 60_000);
  // The confirm screen renewing a waitlist hold (same token, same slot) must not
  // strip its cascade link nor shorten it.
  if (p.proposalId === undefined) {
    const prev = await prisma.slotHold.findFirst({ where: { holderKey: p.holderKey, proposalId: { startsWith: WL_PREFIX }, staffId: p.staffId, startTime: p.startTime, date: new Date(p.dateISO + "T00:00:00.000Z") } });
    if (prev) {
      p = { ...p, proposalId: prev.proposalId, customerId: p.customerId ?? prev.customerId };
      if (prev.expiresAt > expiresAt) expiresAt = prev.expiresAt;
    }
  }
  await prisma.slotHold.deleteMany({ where: { holderKey: p.holderKey } });
  await prisma.slotHold.create({
    data: {
      businessId: p.businessId, staffId: p.staffId, date: new Date(p.dateISO + "T00:00:00.000Z"),
      startTime: p.startTime, endTime: p.endTime, customerId: p.customerId ?? null, proposalId: p.proposalId ?? null,
      holderKey: p.holderKey, expiresAt,
    },
  });
}

/** The confirm screen leaving: drop its hold — but a waitlist turn's hold stays
 *  until the turn ends (leaving the screen mustn't open the slot to everyone). */
export async function releaseScreenHold(holderKey: string): Promise<void> {
  await prisma.slotHold.deleteMany({ where: { holderKey, OR: [{ proposalId: null }, { NOT: { proposalId: { startsWith: WL_PREFIX } } }] } }).catch(() => {});
}

export async function releaseHolds(p: { holderKey?: string | null; proposalId?: string | null }): Promise<void> {
  const or: Record<string, unknown>[] = [];
  if (p.holderKey) or.push({ holderKey: p.holderKey });
  if (p.proposalId) or.push({ proposalId: p.proposalId });
  if (!or.length) return;
  await prisma.slotHold.deleteMany({ where: { OR: or } }).catch(() => {});
}

/** Is this exact slot free for this holder right now (bookings + other holders' holds)? */
export async function slotIsFree(p: { staffId: string; dateISO: string; startTime: string; endTime: string; holderKey?: string | null }): Promise<boolean> {
  const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const day = new Date(p.dateISO + "T00:00:00.000Z"), dayEnd = new Date(day.getTime() + 86_400_000);
  const s = toMin(p.startTime), e = toMin(p.endTime);
  const [booked, holds] = await Promise.all([
    prisma.appointment.findMany({ where: { staffId: p.staffId, date: { gte: day, lt: dayEnd }, status: { in: ["pending", "confirmed"] } }, select: { startTime: true, endTime: true, busySegments: true, bufferAfterMin: true } }),
    activeHolds({ staffIds: [p.staffId], from: day, to: day, exemptHolderKeys: [p.holderKey] }),
  ]);
  // A booking blocks only its busy parts (stage B: processing frees the staff, cleaning keeps her busy).
  const busy = [...booked.flatMap(bookedBusy), ...holds.map(h => ({ s: toMin(h.startTime), e: toMin(h.endTime) }))];
  return !busy.some(b => s < b.e && e > b.s);
}

/** Old expired rows are useless; sweep them opportunistically. */
export async function pruneExpiredHolds(): Promise<void> {
  await prisma.slotHold.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } }).catch(() => {});
}
