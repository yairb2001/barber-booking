import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const staff = await prisma.staff.update({
    where: { id: params.id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.avatarUrl !== undefined && { avatarUrl: body.avatarUrl }),
      ...(body.isAvailable !== undefined && { isAvailable: body.isAvailable }),
      ...(body.inQuickPool !== undefined && { inQuickPool: body.inQuickPool }),
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
    },
  });
  return NextResponse.json(staff);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const staffId = params.id;

  // Block if future confirmed appointments exist
  const futureAppts = await prisma.appointment.count({
    where: {
      staffId,
      date: { gte: new Date() },
      status: { in: ["confirmed", "pending"] },
    },
  });
  if (futureAppts > 0) {
    return NextResponse.json(
      { error: `לא ניתן למחוק — יש ${futureAppts} תורים עתידיים פעילים` },
      { status: 409 }
    );
  }

  // Cascade-delete related data
  await prisma.$transaction([
    prisma.staffScheduleOverride.deleteMany({ where: { staffId } }),
    prisma.staffSchedule.deleteMany({ where: { staffId } }),
    prisma.staffService.deleteMany({ where: { staffId } }),
    prisma.portfolioItem.deleteMany({ where: { staffId } }),
    prisma.waitlist.deleteMany({ where: { staffId } }),
    prisma.staff.delete({ where: { id: staffId } }),
  ]);

  return NextResponse.json({ ok: true });
}
