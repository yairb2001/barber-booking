import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyWaitlistForDayOpen } from "@/lib/waitlist-notify";
import { requireOwnStaffOrOwner } from "@/lib/session";
import { getDayOfWeekISO } from "@/lib/utils";

/** Net available minutes = sum(slot durations) − sum(break durations). */
function netMinutesOf(slotsJson: string | null, breaksJson: string | null): number {
  const parse = (j: string | null): { start: string; end: string }[] => {
    if (!j) return [];
    try { const v = JSON.parse(j); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const slotMin  = parse(slotsJson).reduce((a, x) => a + Math.max(0, toMin(x.end) - toMin(x.start)), 0);
  const breakMin = parse(breaksJson).reduce((a, x) => a + Math.max(0, toMin(x.end) - toMin(x.start)), 0);
  return Math.max(0, slotMin - breakMin);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwnStaffOrOwner(req, params.id);
  if (guard) return guard;

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  if (!dateParam) return NextResponse.json(null);

  const date = new Date(dateParam + "T00:00:00.000Z");
  const override = await prisma.staffScheduleOverride.findUnique({
    where: { staffId_date: { staffId: params.id, date } },
  });
  return NextResponse.json(override);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwnStaffOrOwner(req, params.id);
  if (guard) return guard;

  const body = await req.json();
  const dateStr = body.date.split("T")[0] + "T00:00:00.000Z"; // always UTC midnight
  const date = new Date(dateStr);
  const slots  = body.isWorking && body.slots ? JSON.stringify(body.slots) : null;
  const breaks = body.breaks && body.breaks.length > 0 ? JSON.stringify(body.breaks) : null;

  // ── Decide whether availability EXPANDED ──────────────────────────────────
  // We notify the waitlist whenever the available time for this day grows:
  //   • a closed day is re-opened
  //   • a break is removed
  //   • working hours are extended
  // We compare net available minutes BEFORE vs AFTER this change.
  const prevOverride = await prisma.staffScheduleOverride.findUnique({
    where: { staffId_date: { staffId: params.id, date } },
    select: { isWorking: true, slots: true, breaks: true },
  });

  let beforeAvail: number;
  if (prevOverride) {
    beforeAvail = prevOverride.isWorking ? netMinutesOf(prevOverride.slots, prevOverride.breaks) : 0;
  } else {
    // No override yet → baseline is the weekly default schedule for this weekday
    const dow = getDayOfWeekISO(String(body.date).split("T")[0]);
    const weekly = await prisma.staffSchedule.findUnique({
      where: { staffId_dayOfWeek: { staffId: params.id, dayOfWeek: dow } },
      select: { isWorking: true, slots: true, breaks: true },
    });
    beforeAvail = weekly?.isWorking ? netMinutesOf(weekly.slots, weekly.breaks) : 0;
  }
  const afterAvail = body.isWorking === true ? netMinutesOf(slots, breaks) : 0;

  await prisma.staffScheduleOverride.upsert({
    where: { staffId_date: { staffId: params.id, date } },
    create: {
      staffId:   params.id,
      date,
      isWorking: body.isWorking,
      slots,
      breaks,
      reason:    body.reason || null,
    },
    update: {
      isWorking: body.isWorking,
      slots,
      breaks,
      reason:    body.reason || null,
    },
  });

  // If availability expanded (day opened / break removed / hours added) → notify waitlist,
  // unless the caller explicitly opted out (notifyWaitlist: false).
  if (afterAvail > beforeAvail && body.notifyWaitlist !== false) {
    // Look up businessId from staff record
    const staff = await prisma.staff.findUnique({
      where: { id: params.id },
      select: { businessId: true },
    });
    if (staff) {
      notifyWaitlistForDayOpen({
        businessId: staff.businessId,
        staffId:    params.id,
        date,
      }).catch(console.error);
    }
  }

  return NextResponse.json({ ok: true });
}
