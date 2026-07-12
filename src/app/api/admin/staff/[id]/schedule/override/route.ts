import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyWaitlistForDayOpen } from "@/lib/waitlist-notify";
import { requireStaffInBusiness, getRequestSession, getEffectivePermissions } from "@/lib/session";
import { getDayOfWeekISO } from "@/lib/utils";

/**
 * Guard for managing a staff member's day schedule/breaks.
 * Tenant isolation (requireStaffInBusiness) PLUS: a regular barber may only
 * touch their OWN day. Owners and sub-managers (canViewAllCalendars) may manage
 * any staff's day — that's what the cross-staff calendar break modals need.
 */
async function guardManageStaffDay(req: NextRequest, staffId: string): Promise<NextResponse | null> {
  const tenantGuard = await requireStaffInBusiness(req, staffId);
  if (tenantGuard) return tenantGuard;
  const session = getRequestSession(req);
  if (session && !session.isOwner && session.staffId !== staffId) {
    const perms = await getEffectivePermissions(req);
    if (!perms.canViewAllCalendars) {
      return NextResponse.json({ error: "אין הרשאה לנהל יומן של ספר אחר" }, { status: 403 });
    }
  }
  return null;
}

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
  const guard = await guardManageStaffDay(req, params.id);
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
  const guard = await guardManageStaffDay(req, params.id);
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

  // ── Availability expanded? (day opened / break removed / hours added) ───────
  // Policy: we ALWAYS ask the manager before messaging the waitlist. So by
  // default this route does NOT auto-send — it only reports that availability
  // grew (and how many people are waiting that day) so the client can prompt.
  // Two exceptions:
  //   • body.notifyWaitlist === true  → caller already got the manager's "yes"
  //     and wants us to send now.
  //   • body.notifyWaitlist === false → silent (e.g. drag-move of a break);
  //     never prompt, never send.
  const expanded = afterAvail > beforeAvail;
  let waitlistCount = 0;

  if (expanded && body.notifyWaitlist !== false) {
    const staff = await prisma.staff.findUnique({
      where: { id: params.id },
      select: { businessId: true },
    });
    if (staff) {
      if (body.notifyWaitlist === true) {
        // Manager already confirmed → send now.
        notifyWaitlistForDayOpen({
          businessId: staff.businessId,
          staffId:    params.id,
          date,
        }).catch(console.error);
      } else {
        // Default path → report how many are waiting so the client can ask.
        waitlistCount = await prisma.waitlist.count({
          where: {
            businessId: staff.businessId,
            date,
            status: "waiting",
            OR: [{ staffId: params.id }, { staffId: null }],
          },
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    availabilityExpanded: expanded,
    waitlistCount,
  });
}
