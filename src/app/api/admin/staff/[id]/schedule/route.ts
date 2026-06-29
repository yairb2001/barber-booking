import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnStaffOrOwner, requireStaffInBusiness } from "@/lib/session";

type BreakRange = { start: string; end: string };

// Build the breaks JSON from either the new `breaks[]` array or the legacy
// single breakStart/breakEnd pair (backward compatible).
function buildBreaksJson(day: { breaks?: BreakRange[]; breakStart?: string; breakEnd?: string }): string | null {
  if (Array.isArray(day.breaks)) {
    const valid = day.breaks.filter(b => b && b.start && b.end);
    return valid.length > 0 ? JSON.stringify(valid) : null;
  }
  if (day.breakStart && day.breakEnd) {
    return JSON.stringify([{ start: day.breakStart, end: day.breakEnd }]);
  }
  return null;
}

// Save full weekly schedule for a staff member
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwnStaffOrOwner(req, params.id);
  if (guard) return guard;
  const tenantGuard = await requireStaffInBusiness(req, params.id);
  if (tenantGuard) return tenantGuard;

  const days: { dayOfWeek: number; isWorking: boolean; start: string; end: string; breaks?: BreakRange[]; breakStart?: string; breakEnd?: string }[] =
    await req.json();

  for (const day of days) {
    const slots = JSON.stringify([{ start: day.start, end: day.end }]);
    const breaks = buildBreaksJson(day);

    await prisma.staffSchedule.upsert({
      where: { staffId_dayOfWeek: { staffId: params.id, dayOfWeek: day.dayOfWeek } },
      create: { staffId: params.id, dayOfWeek: day.dayOfWeek, isWorking: day.isWorking, slots, breaks },
      update: { isWorking: day.isWorking, slots, breaks },
    });
  }

  return NextResponse.json({ ok: true });
}

// Update a SINGLE weekday's recurring schedule (used by the calendar day panel
// when the admin edits a recurring break "for every <weekday>").
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwnStaffOrOwner(req, params.id);
  if (guard) return guard;
  const tenantGuard = await requireStaffInBusiness(req, params.id);
  if (tenantGuard) return tenantGuard;

  const body: { dayOfWeek: number; isWorking?: boolean; slots?: BreakRange[]; breaks?: BreakRange[] } = await req.json();
  if (typeof body.dayOfWeek !== "number") {
    return NextResponse.json({ error: "dayOfWeek required" }, { status: 400 });
  }

  // Preserve existing values when a field isn't supplied
  const existing = await prisma.staffSchedule.findUnique({
    where: { staffId_dayOfWeek: { staffId: params.id, dayOfWeek: body.dayOfWeek } },
  });

  const slots = body.slots
    ? JSON.stringify(body.slots)
    : (existing?.slots || JSON.stringify([{ start: "09:00", end: "20:00" }]));
  const breaks = buildBreaksJson(body);
  const isWorking = typeof body.isWorking === "boolean" ? body.isWorking : (existing?.isWorking ?? true);

  await prisma.staffSchedule.upsert({
    where: { staffId_dayOfWeek: { staffId: params.id, dayOfWeek: body.dayOfWeek } },
    create: { staffId: params.id, dayOfWeek: body.dayOfWeek, isWorking, slots, breaks },
    update: { isWorking, slots, breaks },
  });

  return NextResponse.json({ ok: true });
}
