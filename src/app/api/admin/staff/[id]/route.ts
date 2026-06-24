import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const staff = await prisma.staff.findUnique({
    where: { id: params.id },
    include: { schedules: true },
  });
  if (!staff) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(staff);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();

  // Barbers can update only their own record, and only limited fields
  if (!session.isOwner) {
    if (session.staffId !== params.id) {
      return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
    }
    // Only avatarUrl, tagline and settings are self-editable by barbers
    const data: Record<string, unknown> = {};
    if (body.avatarUrl !== undefined) data.avatarUrl = body.avatarUrl;
    if (body.tagline !== undefined) data.tagline = body.tagline ? String(body.tagline).trim() : null;
    if (body.settings !== undefined) {
      data.settings = body.settings === null ? null
        : typeof body.settings === "string" ? body.settings
        : JSON.stringify(body.settings);
    }
    const staff = await prisma.staff.update({ where: { id: params.id }, data });
    return NextResponse.json(staff);
  }

  // Owner — full update
  const guard = requireOwner(req);
  if (guard) return guard;
  const staff = await prisma.staff.update({
    where: { id: params.id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.tagline !== undefined && { tagline: body.tagline ? String(body.tagline).trim() : null }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.avatarUrl !== undefined && { avatarUrl: body.avatarUrl }),
      ...(body.isAvailable !== undefined && { isAvailable: body.isAvailable }),
      ...(body.inQuickPool !== undefined && { inQuickPool: body.inQuickPool }),
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      ...(body.settings !== undefined && {
        settings: body.settings === null ? null
          : typeof body.settings === "string" ? body.settings
          : JSON.stringify(body.settings),
      }),
      ...(body.canViewAllCalendars !== undefined && { canViewAllCalendars: !!body.canViewAllCalendars }),
      ...(body.canViewAllChats     !== undefined && { canViewAllChats:     !!body.canViewAllChats     }),
    },
  });
  return NextResponse.json(staff);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
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
