import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const date = new Date(body.date);
  const slots = body.isWorking && body.slots ? JSON.stringify(body.slots) : null;

  await prisma.staffScheduleOverride.upsert({
    where: { staffId_date: { staffId: params.id, date } },
    create: { staffId: params.id, date, isWorking: body.isWorking, slots, reason: body.reason || null },
    update: { isWorking: body.isWorking, slots, reason: body.reason || null },
  });
  return NextResponse.json({ ok: true });
}
