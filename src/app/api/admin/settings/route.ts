import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness, requireOwner } from "@/lib/session";

// GET /api/admin/settings — readable by all authenticated admins/barbers
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await getSessionBusiness(req, { id: true, slug: true, settings: true, bookingHorizonDays: true });
  if (!business) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    id: business.id,
    slug: business.slug ?? null,
    settings: business.settings ?? null,
    bookingHorizonDays: business.bookingHorizonDays ?? 30,
  });
}

// PATCH /api/admin/settings — owner only
export async function PATCH(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const body = await req.json();
  const business = await getSessionBusiness(req);
  if (!business) return NextResponse.json({ error: "not found" }, { status: 404 });

  const existing = (() => {
    try { return business.settings ? JSON.parse(business.settings) : {}; } catch { return {}; }
  })();

  // Business-wide permission switches are a convenience that BULK-WRITE the
  // per-barber flags. The per-staff flags (Staff.canViewAllCalendars /
  // canViewAllChats) are the authoritative runtime control (see
  // getEffectivePermissions). So when the owner flips a global switch here,
  // apply it to every barber in the business; afterwards the owner can still
  // override an individual barber from /admin/staff/[id].
  if (
    "barbersCanViewOthersCalendar" in body &&
    body.barbersCanViewOthersCalendar !== existing.barbersCanViewOthersCalendar
  ) {
    await prisma.staff.updateMany({
      where: { businessId: business.id, role: "barber" },
      data: { canViewAllCalendars: !!body.barbersCanViewOthersCalendar },
    });
  }
  if (
    "barbersCanAccessChats" in body &&
    body.barbersCanAccessChats !== existing.barbersCanAccessChats
  ) {
    await prisma.staff.updateMany({
      where: { businessId: business.id, role: "barber" },
      data: { canViewAllChats: !!body.barbersCanAccessChats },
    });
  }

  const updated = await prisma.business.update({
    where: { id: business.id },
    data: { settings: JSON.stringify({ ...existing, ...body }) },
  });

  return NextResponse.json({ ok: true, settings: updated.settings });
}
