import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { timeToMinutes } from "@/lib/utils";

// ── GET — list recurring rules (optionally for a customer) ────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const activeOnly = searchParams.get("active") !== "false";

  const rules = await prisma.recurringAppointment.findMany({
    where: {
      ...(customerId ? { customerId } : {}),
      ...(activeOnly ? { active: true } : {}),
    },
    include: { customer: true, staff: true, service: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rules);
}

// ── POST — create a recurring rule + generate first N occurrences ─────────────
//
// Body: {
//   customerId, staffId, serviceId,
//   dayOfWeek (0-6), startTime "HH:MM",
//   frequencyWeeks (1|2|4),
//   startDate "YYYY-MM-DD",
//   endDate? "YYYY-MM-DD",
//   price?, note?,
//   horizonWeeks? (default 12 = generate occurrences covering next 12 weeks)
// }
export async function POST(req: NextRequest) {
  const body = await req.json();

  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "no business" }, { status: 400 });

  if (!body.customerId || !body.staffId || !body.serviceId ||
      body.dayOfWeek === undefined || !body.startTime || !body.startDate) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const service = await prisma.service.findUnique({ where: { id: body.serviceId } });
  if (!service) return NextResponse.json({ error: "service not found" }, { status: 400 });

  const freq = [1, 2, 4].includes(Number(body.frequencyWeeks)) ? Number(body.frequencyWeeks) : 1;
  const startDate = new Date(String(body.startDate).split("T")[0] + "T00:00:00.000Z");
  const endDate = body.endDate
    ? new Date(String(body.endDate).split("T")[0] + "T00:00:00.000Z")
    : null;

  // Create the rule
  const rule = await prisma.recurringAppointment.create({
    data: {
      businessId: business.id,
      customerId: body.customerId,
      staffId:    body.staffId,
      serviceId:  body.serviceId,
      dayOfWeek:  Number(body.dayOfWeek),
      startTime:  String(body.startTime),
      frequencyWeeks: freq,
      startDate,
      endDate,
      price: body.price !== undefined ? Number(body.price) : null,
      note:  body.note || null,
    },
  });

  // Generate occurrences forward
  const horizonWeeks = Math.min(Math.max(Number(body.horizonWeeks) || 12, 1), 52);
  const duration = service.durationMinutes;
  const [sh, sm] = String(body.startTime).split(":").map(Number);
  const startMins = sh * 60 + sm;
  const endMins = startMins + duration;
  const endTime = `${String(Math.floor(endMins / 60)).padStart(2, "0")}:${String(endMins % 60).padStart(2, "0")}`;

  // First occurrence: find the first date on/after startDate matching dayOfWeek
  const cursor = new Date(startDate);
  while (cursor.getUTCDay() !== Number(body.dayOfWeek)) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const horizonEnd = new Date(startDate);
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + horizonWeeks * 7);
  const finalEnd = endDate && endDate < horizonEnd ? endDate : horizonEnd;

  let created = 0;
  let skipped = 0;
  while (cursor <= finalEnd) {
    // Conflict check per occurrence
    const dayISO = cursor.toISOString().split("T")[0];
    const dayUTC = new Date(dayISO + "T00:00:00.000Z");
    const existing = await prisma.appointment.findMany({
      where: {
        staffId: body.staffId,
        date: dayUTC,
        status: { in: ["pending", "confirmed"] },
      },
      select: { startTime: true, endTime: true },
    });
    const conflict = existing.some(apt => {
      const aStart = timeToMinutes(apt.startTime);
      const aEnd   = timeToMinutes(apt.endTime);
      return startMins < aEnd && endMins > aStart;
    });

    if (!conflict) {
      await prisma.appointment.create({
        data: {
          businessId: business.id,
          customerId: body.customerId,
          staffId:    body.staffId,
          serviceId:  body.serviceId,
          date: dayUTC,
          startTime: String(body.startTime),
          endTime,
          status: "confirmed",
          price: body.price !== undefined ? Number(body.price) : service.price,
          note: body.note || null,
          recurringId: rule.id,
        },
      });
      created++;
    } else {
      skipped++;
    }

    cursor.setUTCDate(cursor.getUTCDate() + 7 * freq);
  }

  return NextResponse.json({ rule, created, skipped }, { status: 201 });
}
