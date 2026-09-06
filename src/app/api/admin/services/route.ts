import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness, requireOwner } from "@/lib/session";

export async function GET(req: NextRequest) {
  // Barbers also need to read services (for the new appointment modal)
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const staffId = req.nextUrl.searchParams.get("staffId");
  if (staffId) {
    // Per-barber resolved list — only services this barber actually offers
    // (shared services they've been enabled for, plus their own private
    // ones), with their custom name/price/duration overrides applied. Same
    // merge as the customer-facing /api/services?staffId=, so editing an
    // appointment shows exactly what that barber's own booking page shows.
    const staffServices = await prisma.staffService.findMany({
      where: { staffId, service: { businessId: session.businessId } },
      include: { service: true },
    });
    const services = staffServices
      .filter(ss => !(ss.service.name === "שירות זמני" && !ss.service.isVisible))
      .map(ss => ({
        ...ss.service,
        name: ss.customName ?? ss.service.name,
        description: ss.customDescription ?? ss.service.description,
        note: ss.customNote ?? ss.service.note,
        price: ss.customPrice ?? ss.service.price,
        durationMinutes: ss.customDuration ?? ss.service.durationMinutes,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return NextResponse.json(services);
  }

  const services = await prisma.service.findMany({
    where: {
      businessId: session.businessId,
      // Hide the internal "שירות זמני" placeholder used to satisfy the FK for
      // ad-hoc temporary services — it is plumbing, not a bookable service.
      NOT: { name: "שירות זמני", isVisible: false },
    },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(services);
}

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const body = await req.json();
  const business = await getSessionBusiness(req);
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  const service = await prisma.service.create({
    data: {
      businessId: business.id,
      name: body.name,
      description: body.description || null,
      price: parseFloat(body.price),
      durationMinutes: parseInt(body.durationMinutes),
      isVisible: body.isVisible ?? true,
      showDuration: body.showDuration ?? true,
      sortOrder: body.sortOrder ?? 0,
    },
  });
  return NextResponse.json(service, { status: 201 });
}
