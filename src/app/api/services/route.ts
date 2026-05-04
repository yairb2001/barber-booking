import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const staffId = searchParams.get("staffId");

  if (staffId) {
    // Get services for a specific staff member
    const staffServices = await prisma.staffService.findMany({
      where: { staffId },
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
      customPrice: ss.customPrice,
      customDuration: ss.customDuration,
    }));

    return NextResponse.json(services);
  }

  // Get all visible services
  const services = await prisma.service.findMany({
    where: { isVisible: true },
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
