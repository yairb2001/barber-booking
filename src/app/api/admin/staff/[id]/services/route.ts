import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";

// GET /api/admin/staff/[id]/services — all services with whether this staff offers them
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const [allServices, staffServices] = await Promise.all([
    prisma.service.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.staffService.findMany({ where: { staffId: params.id } }),
  ]);

  const staffMap = Object.fromEntries(staffServices.map(ss => [ss.serviceId, ss]));

  return NextResponse.json(
    allServices.map(s => ({
      id: s.id,
      name: s.name,
      price: s.price,
      durationMinutes: s.durationMinutes,
      isVisible: s.isVisible,
      enabled: !!staffMap[s.id],
      customPrice: staffMap[s.id]?.customPrice ?? null,
      customDuration: staffMap[s.id]?.customDuration ?? null,
    }))
  );
}

// POST /api/admin/staff/[id]/services — toggle or update a service for this staff
// Body: { serviceId, enabled, customPrice?, customDuration? }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const body = await req.json();
  const { serviceId, enabled, customPrice, customDuration } = body;

  if (enabled) {
    await prisma.staffService.upsert({
      where: { staffId_serviceId: { staffId: params.id, serviceId } },
      create: {
        staffId: params.id,
        serviceId,
        customPrice: customPrice ?? null,
        customDuration: customDuration ?? null,
      },
      update: {
        customPrice: customPrice ?? null,
        customDuration: customDuration ?? null,
      },
    });
  } else {
    await prisma.staffService.deleteMany({
      where: { staffId: params.id, serviceId },
    });
  }

  return NextResponse.json({ ok: true });
}
