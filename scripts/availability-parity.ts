/**
 * Availability parity harness (stage B of the verticals plan, 16.10.2026).
 *
 * Free times are computed in nine places (see docs in src/lib/availability/).
 * Before any of them moves onto the shared engine, this records what every
 * surface answers today, for every business × available staff × service ×
 * the next 14 days, with the clock frozen; after a change it runs again and
 * diffs. DOMINANT must come out identical, byte for byte.
 *
 * Read-only. Run from the tree being measured (so "@/…" resolves there):
 *   PARITY_NOW=2026-10-16T09:00:00+03:00 npx tsx scripts/availability-parity.ts snap out.json [businessId,…]
 *   npx tsx scripts/availability-parity.ts diff before.json after.json
 * Live bookings between two snaps show up as diffs on that staff-day: re-snap
 * both trees back to back before reading anything into a diff.
 */
import fs from "fs";
import path from "path";

type Snap = { now: string; results: Record<string, unknown> };

function freezeClock(iso: string) {
  const fixed = new Date(iso).getTime();
  const Real = Date;
  class Frozen extends Real {
    constructor(...a: unknown[]) {
      if (a.length === 0) super(fixed);
      else super(...(a as [string]));
    }
    static now() { return fixed; }
  }
  (globalThis as { Date: DateConstructor }).Date = Frozen as unknown as DateConstructor;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } }));
}

async function snap(out: string, onlyBiz: string[] | null) {
  const nowIso = process.env.PARITY_NOW || new Date().toISOString();
  freezeClock(nowIso);
  const root = process.cwd();
  const mod = (p: string) => import(path.join(root, p));
  const { prisma } = await mod("src/lib/prisma.ts");
  const { getBusinessNow, addDaysISO } = await mod("src/lib/utils.ts");
  const { computeDayAvailability } = await mod("src/lib/agent/availability.ts");
  const { buildAvailabilityIndex } = await mod("src/lib/availability-index.ts");
  const { computeQuickSlots } = await mod("src/lib/quick-slots.ts");
  const routes = {
    W: (await mod("src/app/api/slots/route.ts")).GET,
    Wa: (await mod("src/app/api/slots/availability/route.ts")).GET,
    Wu: (await mod("src/app/api/slots/upcoming/route.ts")).GET,
    T: (await mod("src/app/api/slots/team-by-date/route.ts")).GET,
    Tu: (await mod("src/app/api/slots/upcoming-team/route.ts")).GET,
  } as Record<string, (r: Request) => Promise<Response>>;

  const today: string = getBusinessNow().date;
  const days = Array.from({ length: 14 }, (_, i) => addDaysISO(today, i) as string);
  const results: Record<string, unknown> = {};
  const call = async (key: string, f: () => Promise<unknown>) => {
    try { results[key] = await f(); } catch (e) { results[key] = { error: String((e as Error).message ?? e).slice(0, 200) }; }
  };
  const get = (name: string, q: Record<string, string>) => async () => {
    const res = await routes[name](new Request(`http://parity.local/x?${new URLSearchParams(q)}`));
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const businesses = await prisma.business.findMany({ where: onlyBiz ? { id: { in: onlyBiz } } : {}, select: { id: true, name: true } });
  for (const b of businesses) {
    const staff = await prisma.staff.findMany({ where: { businessId: b.id, isAvailable: true }, select: { id: true, staffServices: { select: { serviceId: true } } } });
    const services = await prisma.service.findMany({ where: { businessId: b.id }, select: { id: true } });
    const jobs: [string, () => Promise<unknown>][] = [];
    const B = b.id;
    // Business-wide surfaces.
    jobs.push([`Tu|${B}`, get("Tu", { businessId: B })]);
    jobs.push([`Q|${B}`, () => computeQuickSlots({ businessId: B })]);
    jobs.push([`Q-all|${B}`, () => computeQuickSlots({ businessId: B, allStaff: true, leadOverride: 0, singleLimit: 30 })]);
    jobs.push([`I|${B}`, async () => {
      const idx = await buildAvailabilityIndex(B, today, 15);
      const o: Record<string, string[]> = {};
      for (const s of staff) for (const d of days) {
        o[`${s.id}|${d}|null`] = idx.slots(s.id, d, null);
        for (const sv of services) o[`${s.id}|${d}|${sv.id}`] = idx.slots(s.id, d, sv.id);
      }
      return o;
    }]);
    for (const d of days) {
      jobs.push([`T|${B}|${d}`, get("T", { businessId: B, date: d })]);
      for (const sv of services) jobs.push([`T|${B}|${d}|${sv.id}`, get("T", { businessId: B, date: d, serviceId: sv.id })]);
      jobs.push([`A|${B}|${d}`, () => computeDayAvailability(B, d)]);
      jobs.push([`A-all|${B}|${d}`, () => computeDayAvailability(B, d, undefined, undefined, { allStaff: true })]);
      jobs.push([`A-admin|${B}|${d}`, () => computeDayAvailability(B, d, undefined, undefined, { allStaff: true, ignoreLimits: true })]);
    }
    for (const s of staff) {
      jobs.push([`Q-staff|${B}|${s.id}`, () => computeQuickSlots({ businessId: B, staffIdFilter: s.id })]);
      const svcIds: string[] = Array.from(new Set<string>([...s.staffServices.map((x: { serviceId: string }) => x.serviceId), ...services.map((x: { id: string }) => x.id)]));
      for (const sv of svcIds) {
        jobs.push([`Wa|${B}|${s.id}|${sv}`, get("Wa", { businessId: B, staffId: s.id, serviceId: sv, from: days[0], to: days[days.length - 1] })]);
        jobs.push([`Wu|${B}|${s.id}|${sv}`, get("Wu", { businessId: B, staffId: s.id, serviceId: sv })]);
        for (const d of days) {
          jobs.push([`W|${B}|${s.id}|${sv}|${d}`, get("W", { businessId: B, staffId: s.id, serviceId: sv, date: d })]);
          jobs.push([`A|${B}|${s.id}|${sv}|${d}`, () => computeDayAvailability(B, d, s.id, sv)]);
        }
      }
      for (const d of days) jobs.push([`A|${B}|${s.id}|-|${d}`, () => computeDayAvailability(B, d, s.id)]);
    }
    const t0 = Date.now();
    void t0;
    await pool(jobs, 8, ([k, f]) => call(k, f));
    console.error(`${b.name}: ${jobs.length} cases`);
  }
  const snapOut: Snap = { now: nowIso, results };
  fs.writeFileSync(out, JSON.stringify(snapOut));
  console.error(`wrote ${Object.keys(results).length} cases to ${out}`);
  await prisma.$disconnect();
}

function diff(a: string, b: string) {
  const A = JSON.parse(fs.readFileSync(a, "utf8")) as Snap, B = JSON.parse(fs.readFileSync(b, "utf8")) as Snap;
  if (A.now !== B.now) console.log(`⚠ different clocks: ${A.now} vs ${B.now}`);
  const keys = Array.from(new Set([...Object.keys(A.results), ...Object.keys(B.results)]));
  let n = 0;
  const bySurface: Record<string, number> = {};
  for (const k of keys) {
    const x = JSON.stringify(A.results[k]), y = JSON.stringify(B.results[k]);
    if (x !== y) {
      n++;
      const s = k.split("|")[0];
      bySurface[s] = (bySurface[s] ?? 0) + 1;
      if (n <= 15) console.log(`≠ ${k}\n   before: ${(x ?? "—").slice(0, 300)}\n   after:  ${(y ?? "—").slice(0, 300)}`);
    }
  }
  console.log(`\n${keys.length} cases, ${n} differ${n ? " " + JSON.stringify(bySurface) : " ✓"}`);
  process.exitCode = n ? 1 : 0;
}

const [cmd, x, y] = process.argv.slice(2);
if (cmd === "snap") void snap(x, y ? y.split(",") : null);
else if (cmd === "diff") diff(x, y);
else console.error("usage: snap <out.json> [bizIds] | diff <a.json> <b.json>");
