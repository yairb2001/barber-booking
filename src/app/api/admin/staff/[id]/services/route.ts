import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness, getEffectivePermissions, requireOwnStaffOrOwner } from "@/lib/session";

// GET /api/admin/staff/[id]/services — all services with whether this staff offers them
// Returns: shared (owner-managed) services + this barber's own services.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Owner and own-self may always read. A sub-manager (barber with "view all
  // calendars") may also READ another barber's services — needed so booking
  // into that barber's calendar shows their custom service names/prices.
  if (!session.isOwner && session.staffId !== params.id) {
    const perms = await getEffectivePermissions(req);
    if (!perms.canViewAllCalendars) {
      return NextResponse.json({ error: "אין הרשאה למשאב זה" }, { status: 403 });
    }
  }

  const [allServices, staffServices, business] = await Promise.all([
    // Shared pool (ownerStaffId = null) + services owned by this barber.
    prisma.service.findMany({
      where: { OR: [{ ownerStaffId: null }, { ownerStaffId: params.id }] },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.staffService.findMany({ where: { staffId: params.id } }),
    getSessionBusiness(req, { staffManageOwnServices: true }),
  ]);

  const staffMap = Object.fromEntries(staffServices.map(ss => [ss.serviceId, ss]));
  // The owner can always manage own services; a barber only when the toggle is on.
  const canManageOwn = (session?.isOwner ?? false) || !!business?.staffManageOwnServices;

  return NextResponse.json({
    canManageOwn,
    services: allServices.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      price: s.price,
      durationMinutes: s.durationMinutes,
      isVisible: s.isVisible,
      owned: s.ownerStaffId === params.id,          // belongs to this barber
      enabled: s.ownerStaffId === params.id ? true : !!staffMap[s.id],
      customPrice: staffMap[s.id]?.customPrice ?? null,
      customDuration: staffMap[s.id]?.customDuration ?? null,
      customName: staffMap[s.id]?.customName ?? null,
      customDescription: staffMap[s.id]?.customDescription ?? null,
      customNote: staffMap[s.id]?.customNote ?? null,
    })),
  });
}

// POST /api/admin/staff/[id]/services — manage this staff's services.
// Actions:
//   (default toggle)   { serviceId, enabled, customPrice?, customDuration?, customName?, customNote? }
//   create own service { action: "create-own", name, price, durationMinutes }
//   update own service { action: "update-own", serviceId, name?, price?, durationMinutes? }
//   delete own service { action: "delete-own", serviceId }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwnStaffOrOwner(req, params.id);
  if (guard) return guard;
  const session = getRequestSession(req);
  const body = await req.json();
  const action = body.action as string | undefined;

  // ── Own-service management (create/update/delete) ──
  if (action === "create-own" || action === "update-own" || action === "delete-own") {
    // A barber may only manage their own services when the owner enabled it.
    if (session && !session.isOwner) {
      const biz = await getSessionBusiness(req, { staffManageOwnServices: true });
      if (!biz?.staffManageOwnServices) {
        return NextResponse.json(
          { error: "ניהול שירותים אישי מושבת. פנה למנהל." },
          { status: 403 }
        );
      }
    }

    if (action === "create-own") {
      const name = String(body.name || "").trim();
      const price = parseFloat(body.price);
      const durationMinutes = parseInt(body.durationMinutes);
      if (!name || !(price >= 0) || !(durationMinutes > 0)) {
        return NextResponse.json({ error: "נתונים חסרים" }, { status: 400 });
      }
      const staff = await prisma.staff.findUnique({ where: { id: params.id }, select: { businessId: true } });
      if (!staff) return NextResponse.json({ error: "ספר לא נמצא" }, { status: 404 });

      const service = await prisma.service.create({
        data: {
          businessId: staff.businessId,
          ownerStaffId: params.id,
          name,
          description: body.description ? String(body.description).trim() : null,
          price,
          durationMinutes,
          isVisible: body.isVisible ?? true,
          showDuration: body.showDuration ?? true,
        },
      });
      // Auto-enable for the owning barber.
      await prisma.staffService.create({ data: { staffId: params.id, serviceId: service.id } });
      return NextResponse.json({ ok: true, id: service.id }, { status: 201 });
    }

    // For update/delete, verify the service is actually owned by this barber.
    const svc = await prisma.service.findUnique({
      where: { id: body.serviceId },
      select: { ownerStaffId: true },
    });
    if (!svc || svc.ownerStaffId !== params.id) {
      return NextResponse.json({ error: "שירות לא נמצא" }, { status: 404 });
    }

    if (action === "update-own") {
      await prisma.service.update({
        where: { id: body.serviceId },
        data: {
          ...(body.name !== undefined && { name: String(body.name).trim() }),
          ...(body.description !== undefined && { description: body.description ? String(body.description).trim() : null }),
          ...(body.price !== undefined && { price: parseFloat(body.price) }),
          ...(body.durationMinutes !== undefined && { durationMinutes: parseInt(body.durationMinutes) }),
        },
      });
      return NextResponse.json({ ok: true });
    }

    // delete-own
    const apptCount = await prisma.appointment.count({ where: { serviceId: body.serviceId } });
    if (apptCount > 0) {
      return NextResponse.json(
        { error: "לא ניתן למחוק שירות עם תורים. ניתן להסתיר אותו במקום." },
        { status: 400 }
      );
    }
    await prisma.staffService.deleteMany({ where: { serviceId: body.serviceId } });
    await prisma.service.delete({ where: { id: body.serviceId } });
    return NextResponse.json({ ok: true });
  }

  // ── Default: toggle a shared service on/off for this barber ──
  const { serviceId, enabled, customPrice, customDuration, customName, customDescription, customNote } = body;

  // Normalize the per-barber name/description/note overrides: blank → null (use the shared service value).
  const normName = typeof customName === "string" && customName.trim() ? customName.trim() : null;
  const normDescription = typeof customDescription === "string" && customDescription.trim() ? customDescription.trim() : null;
  const normNote = typeof customNote === "string" && customNote.trim() ? customNote.trim() : null;

  if (enabled) {
    await prisma.staffService.upsert({
      where: { staffId_serviceId: { staffId: params.id, serviceId } },
      create: {
        staffId: params.id,
        serviceId,
        customPrice: customPrice ?? null,
        customDuration: customDuration ?? null,
        customName: normName,
        customDescription: normDescription,
        customNote: normNote,
      },
      update: {
        customPrice: customPrice ?? null,
        customDuration: customDuration ?? null,
        customName: normName,
        customDescription: normDescription,
        customNote: normNote,
      },
    });
  } else {
    await prisma.staffService.deleteMany({
      where: { staffId: params.id, serviceId },
    });
  }

  return NextResponse.json({ ok: true });
}
