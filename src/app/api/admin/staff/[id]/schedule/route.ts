import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnStaffOrOwner } from "@/lib/session";

// Save full weekly schedule for a staff member
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwnStaffOrOwner(req, params.id);
  if (guard) return guard;

  const days: { dayOfWeek: number; isWorking: boolean; start: string; end: string; breakStart?: string; breakEnd?: string }[] =
    await req.json();

  for (const day of days) {
    const slots = JSON.stringify([{ start: day.start, end: day.end }]);
    const breaks =
      day.breakStart && day.breakEnd
        ? JSON.stringify([{ start: day.breakStart, end: day.breakEnd }])
        : null;

    await prisma.staffSchedule.upsert({
      where: { staffId_dayOfWeek: { staffId: params.id, dayOfWeek: day.dayOfWeek } },
      create: { staffId: params.id, dayOfWeek: day.dayOfWeek, isWorking: day.isWorking, slots, breaks },
      update: { isWorking: day.isWorking, slots, breaks },
    });
  }

  return NextResponse.json({ ok: true });
}
