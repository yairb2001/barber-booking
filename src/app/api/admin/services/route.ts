import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshGapAutoMin } from "@/lib/gap-policy";
import { getRequestSession, getSessionBusiness, requireOwner } from "@/lib/session";
import { setServiceRooms } from "@/lib/availability/rooms";
import { syncServiceStaff } from "@/lib/service-staff";

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
    include: { rooms: { select: { roomId: true } }, staffServices: { select: { staffId: true } } },
  });
  // roomIds: the rooms each treatment may use (rooms, 16.10.2026); staffIds: who performs it.
  return NextResponse.json(services.map(({ rooms, staffServices, ...s }) => ({ ...s, roomIds: rooms.map(r => r.roomId), staffIds: staffServices.map(x => x.staffId) })));
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
      // The line the agent and the booking page show next to it ("בפעם הראשונה: קודם ייעוץ", 28.10.2026).
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null,
      price: parseFloat(body.price),
      durationMinutes: parseInt(body.durationMinutes),
      isVisible: body.isVisible ?? true,
      showDuration: body.showDuration ?? true,
      sortOrder: body.sortOrder ?? 0,
      category: typeof body.category === "string" && body.category.trim() ? body.category.trim() : null,
      priceFrom: body.priceFrom === true,
      segments: body.segments !== undefined ? (() => { if (body.segments === null) return null; try { const x = JSON.parse(String(body.segments)); return Array.isArray(x) && x.length && x.every((g: { m?: unknown }) => Number(g?.m) > 0) ? JSON.stringify(x.map((g: { m: number; busy?: boolean }) => ({ m: Math.round(Number(g.m)), busy: g.busy !== false }))) : null; } catch { return null; } })() : null,
      bufferAfterMin: (Number.isInteger(body.bufferAfterMin) && body.bufferAfterMin >= 0 && body.bufferAfterMin <= 240 ? body.bufferAfterMin : 0),
      upsellIds: (() => { if (!Array.isArray(body.upsellIds)) return null; const ids = body.upsellIds.filter((x: unknown) => typeof x === "string").slice(0, 5); return ids.length ? JSON.stringify(ids) : null; })(),
      rebookDays: (Number.isInteger(body.rebookDays) && body.rebookDays > 0 && body.rebookDays <= 365 ? body.rebookDays : null),
    },
  });
  await setServiceRooms(service.id, business.id, body.roomIds);
  // Who performs it — default (no list sent): every active staff member, as the form promises.
  const staffIds = Array.isArray(body.staffIds) ? body.staffIds
    : (await prisma.staff.findMany({ where: { businessId: business.id, isActive: true }, select: { id: true } })).map(s => s.id);
  await syncServiceStaff(service.id, business.id, staffIds);
  await refreshGapAutoMin(business.id).catch(() => {});
  return NextResponse.json(service, { status: 201 });
}
