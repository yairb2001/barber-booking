import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";
import { resyncSchedule } from "@/lib/classes";
import { classFields, scheduleRows, type ClassBody } from "@/lib/classes-admin";

/** Update a class type; a new weekly schedule remakes the future sessions nobody booked. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const type = await prisma.classType.findFirst({ where: { id: params.id, businessId: session.businessId }, select: { id: true } });
  if (!type) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as ClassBody;
  await prisma.classType.update({ where: { id: type.id }, data: await classFields(session.businessId, body) });
  if (Array.isArray(body.schedules)) {
    const rows = await scheduleRows(session.businessId, body.schedules);
    await prisma.$transaction([
      prisma.classSchedule.updateMany({ where: { classTypeId: type.id }, data: { isActive: false } }),
      prisma.classSchedule.createMany({ data: rows.map(r => ({ ...r, classTypeId: type.id })) }),
    ]);
  }
  await resyncSchedule(session.businessId, type.id);
  return NextResponse.json({ ok: true });
}

/** Stop a class: no new sessions; future sessions nobody booked go away (booked ones stay). */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const { count } = await prisma.classType.updateMany({ where: { id: params.id, businessId: session.businessId }, data: { isActive: false } });
  if (!count) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.classSchedule.updateMany({ where: { classTypeId: params.id }, data: { isActive: false } });
  await resyncSchedule(session.businessId, params.id);
  return NextResponse.json({ ok: true });
}
