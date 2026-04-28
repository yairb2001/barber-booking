import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyWaitlistForDayOpen } from "@/lib/waitlist-notify";
import { requireOwnStaffOrOwner } from "@/lib/session";

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

  // Check previous state — we only notify waitlist when a day is explicitly RE-OPENED
  // (i.e., there was an override with isWorking=false and now it's being set to true)
  const prevOverride = await prisma.staffScheduleOverride.findUnique({
    where: { staffId_date: { staffId: params.id, date } },
    select: { isWorking: true },
  });
  const wasClosed = prevOverride?.isWorking === false;
  const nowOpening = body.isWorking === true;

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

  // If a previously-closed day just got opened → notify waitlist
  if (wasClosed && nowOpening) {
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
