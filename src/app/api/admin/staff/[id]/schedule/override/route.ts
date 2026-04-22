import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  if (!dateParam) return NextResponse.json(null);

  const date = new Date(dateParam + "T00:00:00");
  const override = await prisma.staffScheduleOverride.findUnique({
    where: { staffId_date: { staffId: params.id, date } },
  });
  return NextResponse.json(override);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  // Support both "date" as full ISO and as date-only string
  const dateStr = body.date.includes("T") ? body.date : body.date + "T00:00:00";
  const date = new Date(dateStr);
  const slots = body.isWorking && body.slots ? JSON.stringify(body.slots) : null;
  const breaks = body.breaks && body.breaks.length > 0 ? JSON.stringify(body.breaks) : null;

  await prisma.staffScheduleOverride.upsert({
    where: { staffId_date: { staffId: params.id, date } },
    create: {
      staffId: params.id,
      date,
      isWorking: body.isWorking,
      slots,
      breaks,
      reason: body.reason || null,
    },
    update: {
      isWorking: body.isWorking,
      slots,
      breaks,
      reason: body.reason || null,
    },
  });
  return NextResponse.json({ ok: true });
}
