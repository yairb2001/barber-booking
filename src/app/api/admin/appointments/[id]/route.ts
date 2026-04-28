import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyWaitlistForCancellation } from "@/lib/waitlist-notify";
import { timeToMinutes } from "@/lib/utils";
import { triggerPostVisitAutomations } from "@/lib/automations";
import { getRequestSession } from "@/lib/session";

const CANCEL_STATUSES = new Set(["cancelled_by_staff", "cancelled_by_customer"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();

  // Fetch current appointment before update
  const before = await prisma.appointment.findUnique({
    where: { id: params.id },
    select: {
      status: true, date: true, staffId: true, startTime: true, businessId: true,
      serviceId: true, endTime: true, price: true,
    },
  });
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Staff scoping: barbers can only modify their own appointments
  const session = getRequestSession(req);
  if (session && !session.isOwner && session.staffId && before.staffId !== session.staffId) {
    return NextResponse.json({ error: "אין הרשאה לתור זה" }, { status: 403 });
  }
  // And cannot reassign to another barber
  if (session && !session.isOwner && session.staffId && body.staffId && body.staffId !== session.staffId) {
    return NextResponse.json({ error: "ספר יכול לעדכן רק תורים של עצמו" }, { status: 403 });
  }

  // Build update data
  const data: Record<string, unknown> = {};
  if (body.status    !== undefined) data.status    = body.status;
  if (body.staffNote !== undefined) data.staffNote = body.staffNote;
  if (body.note      !== undefined) data.note      = body.note;
  if (body.staffId   !== undefined) data.staffId   = body.staffId;
  if (body.serviceId !== undefined) data.serviceId = body.serviceId;
  if (body.price     !== undefined) data.price     = Number(body.price);

  // Date change (YYYY-MM-DD)
  let nextDate: Date = before.date;
  if (body.date !== undefined) {
    nextDate = new Date(String(body.date).split("T")[0] + "T00:00:00.000Z");
    data.date = nextDate;
  }

  // Time / duration change — recompute endTime
  let nextStartTime = before.startTime;
  let nextEndTime   = before.endTime;
  let nextStaffId   = (body.staffId as string) ?? before.staffId;
  let nextServiceId = (body.serviceId as string) ?? before.serviceId;

  if (body.startTime !== undefined || body.durationMinutes !== undefined || body.serviceId !== undefined) {
    const startStr = body.startTime !== undefined ? String(body.startTime) : before.startTime;
    const [sh, sm] = startStr.split(":").map(Number);
    const startMins = sh * 60 + sm;

    let durMin: number;
    if (body.durationMinutes !== undefined && Number(body.durationMinutes) > 0) {
      durMin = Number(body.durationMinutes);
    } else {
      // derive from current endTime or from service default
      const prevStart = timeToMinutes(before.startTime);
      const prevEnd   = timeToMinutes(before.endTime);
      durMin = prevEnd - prevStart;
      if (body.serviceId !== undefined) {
        const svc = await prisma.service.findUnique({ where: { id: body.serviceId } });
        if (svc) durMin = svc.durationMinutes;
      }
    }

    const endMins = startMins + durMin;
    nextStartTime = startStr;
    nextEndTime   = `${String(Math.floor(endMins / 60)).padStart(2, "0")}:${String(endMins % 60).padStart(2, "0")}`;
    data.startTime = nextStartTime;
    data.endTime   = nextEndTime;
  }

  // Conflict check when time/date/staff changes (unless override)
  const timingChanged =
    body.startTime !== undefined || body.durationMinutes !== undefined ||
    body.date !== undefined || body.staffId !== undefined || body.serviceId !== undefined;

  if (timingChanged && !body.override) {
    const startMins = timeToMinutes(nextStartTime);
    const endMins   = timeToMinutes(nextEndTime);
    const others = await prisma.appointment.findMany({
      where: {
        id: { not: params.id },
        staffId: nextStaffId,
        date: nextDate,
        status: { in: ["pending", "confirmed"] },
      },
      select: { startTime: true, endTime: true, customer: { select: { name: true } } },
    });
    const conflict = others.find(apt => {
      const aStart = timeToMinutes(apt.startTime);
      const aEnd   = timeToMinutes(apt.endTime);
      return startMins < aEnd && endMins > aStart;
    });
    if (conflict) {
      return NextResponse.json(
        {
          error: `השעה הזו כבר תפוסה ע״י ${conflict.customer.name} (${conflict.startTime}–${conflict.endTime}). להמשיך בכל זאת?`,
          conflict: true,
        },
        { status: 409 }
      );
    }
  }

  const appointment = await prisma.appointment.update({
    where: { id: params.id },
    data,
    include: { customer: true, staff: true, service: true },
  });

  // If status just changed to completed → update customer's lastVisitAt + fire automations
  const justCompleted =
    before.status !== "completed" && appointment.status === "completed";
  if (justCompleted) {
    prisma.customer.update({
      where: { id: appointment.customerId },
      data:  { lastVisitAt: appointment.date },
    }).catch(console.error);

    triggerPostVisitAutomations({
      id:         appointment.id,
      businessId: appointment.businessId,
      customerId: appointment.customerId,
      staffId:    appointment.staffId,
      serviceId:  appointment.serviceId,
    }).catch(console.error);
  }

  // If status just changed to cancelled → notify waitlist
  const justCancelled =
    !CANCEL_STATUSES.has(before.status) &&
    CANCEL_STATUSES.has(appointment.status);

  if (justCancelled) {
    notifyWaitlistForCancellation({
      businessId: before.businessId,
      staffId:    before.staffId,
      date:       before.date,
      startTime:  before.startTime,
    }).catch(console.error);
  }

  return NextResponse.json(appointment);
}
