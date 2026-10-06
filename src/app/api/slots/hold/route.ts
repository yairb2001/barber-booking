import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { holdSlot, releaseHolds, slotIsFree, holderKeyForWeb, pruneExpiredHolds, SHORT_HOLD_MINUTES } from "@/lib/slot-holds";

// The booking site's confirm screen holds the chosen slot for 5 minutes so two
// visitors (or a visitor and a WhatsApp customer) can't both reach "קביעת תור"
// on the same time. The screen renews while open and releases on leaving;
// the hold expires on its own anyway. `token` is a random id the browser made —
// it only ever unlocks the hold it created.
//   POST { staffId, serviceId, date, time, token }           → { ok, expiresAt } | 409 taken
//   POST { action: "release", token }  (also via sendBeacon) → { ok }
const TOKEN = /^[\w-]{8,64}$/;
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "hold", { max: 60, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const token = typeof body.token === "string" && TOKEN.test(body.token) ? body.token : null;
  if (!token) return NextResponse.json({ error: "token" }, { status: 400 });
  const holderKey = holderKeyForWeb(token);

  if (body.action === "release") {
    await releaseHolds({ holderKey });
    return NextResponse.json({ ok: true });
  }

  const { staffId, serviceId, date, time } = body as { staffId?: string; serviceId?: string; date?: string; time?: string };
  if (!staffId || !serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !/^\d{1,2}:\d{2}$/.test(time ?? "")) {
    return NextResponse.json({ error: "params" }, { status: 400 });
  }
  const [staff, service, ss] = await Promise.all([
    prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, businessId: true } }),
    prisma.service.findUnique({ where: { id: serviceId }, select: { id: true, businessId: true, durationMinutes: true } }),
    prisma.staffService.findFirst({ where: { staffId, serviceId }, select: { customDuration: true } }),
  ]);
  if (!staff || !service || staff.businessId !== service.businessId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const endTime = toTime(toMin(time!) + (ss?.customDuration ?? service.durationMinutes));

  if (!(await slotIsFree({ staffId, dateISO: date!, startTime: time!, endTime, holderKey }))) {
    await releaseHolds({ holderKey }); // whatever this visitor held before is moot now
    return NextResponse.json({ error: "taken" }, { status: 409 });
  }
  await holdSlot({ businessId: staff.businessId, staffId, dateISO: date!, startTime: time!, endTime, holderKey });
  pruneExpiredHolds().catch(() => {});
  return NextResponse.json({ ok: true, expiresAt: new Date(Date.now() + SHORT_HOLD_MINUTES * 60_000).toISOString() });
}
