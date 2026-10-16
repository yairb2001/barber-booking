/**
 * The availability engine (stage B of the verticals plan, 16.10.2026). Pure:
 * no database, minutes since local midnight.
 *
 * Today's rule (generateSlots, every barbershop runs on it): candidates step by
 * the service's length from the start of each working window, and after a
 * break or a booking the next candidate starts exactly where it ends. That is
 * the "legacy" grid, and it stays the default so DOMINANT is unchanged.
 *
 * What beauty adds on top, through the treatment's shape:
 *  - segments: hair color is 30 min work, 35 min processing (the stylist is
 *    free for someone else, the customer stays), 30 min rinse. Only the work
 *    segments make the staff member busy;
 *  - a cleaning buffer after the treatment, when she is busy but the customer
 *    has left;
 *  - a fixed grid (every 5/10/15 minutes) that also offers the exact moment a
 *    booking ends.
 */

export type Iv = { s: number; e: number };
/** One part of a treatment: m minutes; staffBusy false = processing (she is free). */
export type Seg = { m: number; staffBusy: boolean };
export type Shape = { segs: Seg[]; bufferAfter: number };
export type Grid = { mode: "legacy" } | { mode: "fixed"; step: number };

export const LEGACY_GRID: Grid = { mode: "legacy" };

/** A plain treatment: one block, no buffer (every barbershop service). */
export function plainShape(minutes: number): Shape {
  return { segs: [{ m: minutes, staffBusy: true }], bufferAfter: 0 };
}

/** The customer's time in the chair (start to leaving), without the buffer. */
export function shapeLength(sh: Shape): number {
  return sh.segs.reduce((t, x) => t + x.m, 0);
}

export function isPlain(sh: Shape): boolean {
  return sh.bufferAfter === 0 && sh.segs.every(x => x.staffBusy);
}

/** When the staff member is busy for a treatment starting at `start`:
 *  its work segments, then the buffer (joined to a last work segment). */
export function staffBlocks(sh: Shape, start: number): Iv[] {
  const out: Iv[] = [];
  let t = start;
  for (const g of sh.segs) {
    if (g.staffBusy && g.m > 0) {
      const last = out[out.length - 1];
      if (last && last.e === t) last.e = t + g.m; else out.push({ s: t, e: t + g.m });
    }
    t += g.m;
  }
  if (sh.bufferAfter > 0) {
    const last = out[out.length - 1];
    if (last && last.e === t) last.e = t + sh.bufferAfter; else out.push({ s: t, e: t + sh.bufferAfter });
  }
  return out;
}

const overlaps = (a: Iv, b: Iv) => a.s < b.e && a.e > b.s;

/**
 * Exactly generateSlots (src/lib/utils.ts), on minutes: step by the length,
 * re-anchor to the end of whatever blocks the candidate. A zero or negative
 * length (bad data) yields nothing instead of looping forever.
 */
export function legacyGenerate(windows: Iv[], blockers: Iv[], dur: number): number[] {
  if (!(dur > 0)) return [];
  const sorted = [...blockers].sort((a, b) => a.s - b.s);
  const out: number[] = [];
  for (const w of windows) {
    let cur = w.s;
    while (cur + dur <= w.e) {
      const hit = sorted.find(b => cur < b.e && cur + dur > b.s);
      if (hit) { cur = hit.e; continue; }
      out.push(cur);
      cur += dur;
    }
  }
  return out;
}

/** Does a treatment of this shape fit at `start`? The customer's whole visit
 *  inside one working window; the staff member's busy parts clear of `busy`.
 *  The buffer may run past closing (cleaning after the last customer). */
export function fitsAt(windows: Iv[], busy: Iv[], sh: Shape, start: number): boolean {
  const len = shapeLength(sh);
  if (!(len > 0)) return false;
  if (!windows.some(w => start >= w.s && start + len <= w.e)) return false;
  return staffBlocks(sh, start).every(b => !busy.some(x => overlaps(b, x)));
}

/**
 * Free start times. A plain treatment on the legacy grid is generateSlots,
 * untouched. Otherwise every grid point from each window's start (legacy: the
 * treatment's length as the step), plus the exact end of each busy block, so
 * a gap that opens at 10:40 is offered at 10:40.
 */
export function freeStarts(windows: Iv[], busy: Iv[], sh: Shape, grid: Grid = LEGACY_GRID): number[] {
  const len = shapeLength(sh);
  if (!(len > 0)) return [];
  if (grid.mode === "legacy" && isPlain(sh)) return legacyGenerate(windows, busy, len);
  const step = grid.mode === "fixed" && grid.step > 0 ? grid.step : len;
  const cands = new Set<number>();
  for (const w of windows) {
    for (let t = w.s; t + len <= w.e; t += step) cands.add(t);
    for (const b of busy) if (b.e >= w.s && b.e + len <= w.e) cands.add(b.e);
  }
  return Array.from(cands).sort((a, b) => a - b).filter(t => fitsAt(windows, busy, sh, t));
}

/** "HH:MM" ↔ minutes, local to the engine so it stays free of imports. */
export const toMin = (t: string): number => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const toHHMM = (n: number): string => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
