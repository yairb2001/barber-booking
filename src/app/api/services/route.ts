import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { resolveBusinessId } from "@/lib/tenant";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const staffId = searchParams.get("staffId");

  // Resolve businessId from ?slug= / ?businessId= (no param → root business).
  // null means a slug/businessId was supplied but matched nothing → scope to
  // nothing so one tenant's invalid link never spills another tenant's data.
  const resolvedBusinessId = await resolveBusinessId(request);
  if (!resolvedBusinessId) return NextResponse.json([]);

  if (staffId) {
    // Get services for a specific staff member (scoped to the resolved business
    // so a staffId cannot pull services from a different tenant).
    const staffServices = await prisma.staffService.findMany({
      where: { staffId, service: { businessId: resolvedBusinessId } },
      include: {
        service: {
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            durationMinutes: true,
            showDuration: true,
            color: true,
            icon: true,
            note: true,
            sortOrder: true,
          },
        },
      },
    });

    const services = staffServices.map((ss) => ({
      ...ss.service,
      // Per-barber overrides win when set (same underlying service, personal label/note).
      name: ss.customName ?? ss.service.name,
      description: ss.customDescription ?? ss.service.description,
      note: ss.customNote ?? ss.service.note,
      price: ss.customPrice ?? ss.service.price,
      durationMinutes: ss.customDuration ?? ss.service.durationMinutes,
      customPrice: ss.customPrice,
      customDuration: ss.customDuration,
      customName: ss.customName,
      customDescription: ss.customDescription,
      customNote: ss.customNote,
    }));

    return NextResponse.json(services);
  }

  // Get all visible services (scoped to business)
  const services = await prisma.service.findMany({
    where: { isVisible: true, businessId: resolvedBusinessId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      durationMinutes: true,
      showDuration: true,
      color: true,
      icon: true,
      note: true,
      sortOrder: true,
    },
  });

  return NextResponse.json(services);
}
