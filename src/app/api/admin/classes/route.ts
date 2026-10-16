import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";
import { materializeSessions } from "@/lib/classes";
import { classFields, scheduleRows, type ClassBody } from "@/lib/classes-admin";

/**
 * Group classes (16.10.2026): the business's class types with their weekly
 * schedule. Creating one makes its sessions ahead (each blocks its trainer).
 */
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const types = await prisma.classType.findMany({
    where: { businessId: session.businessId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { schedules: { where: { isActive: true }, orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] } },
  });
  return NextResponse.json(types);
}

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const body = (await req.json().catch(() => ({}))) as ClassBody;
  const fields = await classFields(session.businessId, body);
  if (!("name" in fields) || !("durationMinutes" in fields) || !("capacity" in fields)) {
    return NextResponse.json({ error: "צריך שם, משך ומספר מקומות" }, { status: 400 });
  }
  const count = await prisma.classType.count({ where: { businessId: session.businessId } });
  const type = await prisma.classType.create({
    data: { businessId: session.businessId, sortOrder: count, name: fields.name!, durationMinutes: fields.durationMinutes!, capacity: fields.capacity!, ...fields },
  });
  const rows = await scheduleRows(session.businessId, body.schedules);
  if (rows.length) await prisma.classSchedule.createMany({ data: rows.map(r => ({ ...r, classTypeId: type.id })) });
  await materializeSessions(session.businessId);
  return NextResponse.json({ id: type.id }, { status: 201 });
}
