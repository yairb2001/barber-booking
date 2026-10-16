/**
 * From database rows to the engine's shapes (stage B, 16.10.2026). Client-safe
 * (no server imports): the services screen previews a shape with it too.
 *
 *  - A service's shape: its segments (work / processing) and cleaning buffer.
 *    Without segments it is one block of the given length — every barbershop
 *    service, so nothing changes for them.
 *  - A booking's busy time: what it recorded when it was booked
 *    (Appointment.busySegments, bufferAfterMin). Recorded, not re-derived from
 *    the service, so editing a treatment never moves existing bookings.
 */
import { plainShape, shapeLength, staffBlocks, toMin, toHHMM, type Grid, type GapPolicy, type Iv, type Seg, type Shape } from "@/lib/availability/engine";

export type ShapedService = { durationMinutes?: number; segments?: string | null; bufferAfterMin?: number | null };
export type BookedRow = { startTime: string; endTime: string; busySegments?: string | null; bufferAfterMin?: number | null };

/** '[{"m":30,"busy":true},…]' → segments; anything malformed → null (one block). */
export function parseSegments(json: string | null | undefined): Seg[] | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as { m?: unknown; busy?: unknown }[];
    if (!Array.isArray(raw) || !raw.length) return null;
    const segs = raw.map(x => ({ m: Math.round(Number(x.m)), staffBusy: x.busy !== false }));
    return segs.every(x => x.m > 0) && segs.some(x => x.staffBusy) ? segs : null;
  } catch { return null; }
}

/**
 * The treatment's shape for one staff member, `duration` being her length for
 * it (StaffService.customDuration or the service's). When her length differs
 * from the segments' total, the last segment takes the difference (she is
 * slower or faster at the finish); if that would empty it, one block instead.
 */
export function shapeOf(svc: ShapedService | null | undefined, duration: number): Shape {
  const buffer = Math.max(0, Math.round(svc?.bufferAfterMin ?? 0));
  const segs = parseSegments(svc?.segments);
  if (!segs) return { ...plainShape(duration), bufferAfter: buffer };
  const diff = duration - segs.reduce((t, x) => t + x.m, 0);
  const last = segs[segs.length - 1];
  if (last.m + diff <= 0) return { ...plainShape(duration), bufferAfter: buffer };
  return { segs: [...segs.slice(0, -1), { ...last, m: last.m + diff }], bufferAfter: buffer };
}

/** What a booking records: its busy parts as offsets, null when it is one block (as before). */
export function bookingRecord(sh: Shape): { busySegments: string | null; bufferAfterMin: number } {
  const blocks = staffBlocks({ segs: sh.segs, bufferAfter: 0 }, 0);
  const oneBlock = blocks.length === 1 && blocks[0].s === 0 && blocks[0].e === shapeLength(sh);
  return {
    busySegments: oneBlock ? null : JSON.stringify(blocks.map(b => ({ o: b.s, m: b.e - b.s }))),
    bufferAfterMin: sh.bufferAfter,
  };
}

/** The staff member's busy intervals for a booked row (minutes). */
export function bookedBusy(a: BookedRow): Iv[] {
  const s = toMin(a.startTime), e = toMin(a.endTime);
  let out: Iv[] = [{ s, e }];
  if (a.busySegments) {
    try {
      const parts = JSON.parse(a.busySegments) as { o: number; m: number }[];
      if (Array.isArray(parts) && parts.length) out = parts.map(p => ({ s: s + Number(p.o), e: s + Number(p.o) + Number(p.m) }));
    } catch { /* malformed → the whole booking */ }
  }
  const buf = Math.max(0, a.bufferAfterMin ?? 0);
  if (buf > 0) {
    const last = out[out.length - 1];
    if (last && last.e === e) last.e = e + buf; else out.push({ s: e, e: e + buf });
  }
  return out;
}

/** Same, as "HH:MM" pairs for the generateSlots callers. */
export function bookedBusyRows(a: BookedRow): { startTime: string; endTime: string }[] {
  if (!a.busySegments && !(a.bufferAfterMin && a.bufferAfterMin > 0)) return [{ startTime: a.startTime, endTime: a.endTime }];
  return bookedBusy(a).map(iv => ({ startTime: toHHMM(iv.s), endTime: toHHMM(iv.e) }));
}

/**
 * The slot grid. settings.slotGrid: a number of minutes (5, 10, 15, 20, 30) or
 * "legacy". Default: a men's barbershop keeps the legacy rule (step by the
 * service, re-anchor after a booking); every other type, every 15 minutes
 * plus the moment a booking ends.
 */
export function gridOf(biz: { businessType?: string | null; settings?: string | null } | null | undefined): Grid {
  let v: unknown, gp: unknown;
  try { const s = biz?.settings ? (JSON.parse(biz.settings) as { slotGrid?: unknown; gapPolicy?: unknown }) : {}; v = s.slotGrid; gp = s.gapPolicy; } catch { v = undefined; }
  const gaps = gapPolicyOf(gp);
  if (v === "legacy") return { mode: "legacy", gaps };
  const n = Number(v);
  if (Number.isFinite(n) && n >= 5 && n <= 60) return { mode: "fixed", step: Math.round(n), gaps };
  return (biz?.businessType ?? "barber_men") === "barber_men" ? { mode: "legacy", gaps } : { mode: "fixed", step: 15, gaps };
}

/** Business.settings.gapPolicy → the engine's policy. Defaults (owner, 16.10.2026):
 *  no dead gaps, minimum = the shortest service (autoMin, kept fresh by the
 *  services routes), empty days free, adjacent-only off. */
export type StoredGapPolicy = { deadGaps?: boolean; minGap?: number | null; autoMin?: number; adjacentOnly?: boolean; emptyDayFree?: boolean };
export function gapPolicyOf(raw: unknown): GapPolicy {
  const g = (raw && typeof raw === "object" ? raw : {}) as StoredGapPolicy;
  const fixed = Number(g.minGap), auto = Number(g.autoMin);
  const minGap = Number.isFinite(fixed) && fixed > 0 ? fixed : Number.isFinite(auto) && auto > 0 ? auto : 15;
  return { deadGaps: g.deadGaps !== false, minGap, adjacentOnly: g.adjacentOnly === true, emptyDayFree: g.emptyDayFree !== false };
}

/** A booked row back to a shape (a move keeps what it recorded when booked). */
export function shapeOfBooking(a: BookedRow): Shape {
  const len = toMin(a.endTime) - toMin(a.startTime);
  const bufferAfter = Math.max(0, a.bufferAfterMin ?? 0);
  let parts: { o: number; m: number }[] = [];
  try { parts = a.busySegments ? (JSON.parse(a.busySegments) as { o: number; m: number }[]) : []; } catch { parts = []; }
  if (!Array.isArray(parts) || !parts.length) return { segs: [{ m: len, staffBusy: true }], bufferAfter };
  const segs: Seg[] = [];
  let t = 0;
  for (const p of [...parts].sort((x, y) => x.o - y.o)) {
    if (p.o > t) segs.push({ m: p.o - t, staffBusy: false });
    segs.push({ m: p.m, staffBusy: true });
    t = p.o + p.m;
  }
  if (t < len) segs.push({ m: len - t, staffBusy: false });
  return { segs, bufferAfter };
}

/** A shape at another length (an owner resizing a booking): the last segment
 *  takes the difference, or one block if that would empty it. */
export function resizeShape(sh: Shape, len: number): Shape {
  const diff = len - sh.segs.reduce((t, x) => t + x.m, 0);
  if (diff === 0) return sh;
  const last = sh.segs[sh.segs.length - 1];
  if (last.m + diff <= 0) return { segs: [{ m: len, staffBusy: true }], bufferAfter: sh.bufferAfter };
  return { segs: [...sh.segs.slice(0, -1), { ...last, m: last.m + diff }], bufferAfter: sh.bufferAfter };
}
