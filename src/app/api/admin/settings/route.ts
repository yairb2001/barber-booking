import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness, requireOwner } from "@/lib/session";
import { propagateTeamPermissions } from "@/lib/staff-permissions";

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

  await propagateTeamPermissions(business.id, body, existing);

  const updated = await prisma.business.update({
    where: { id: business.id },
    data: { settings: JSON.stringify({ ...existing, ...body }) },
  });

  return NextResponse.json({ ok: true, settings: updated.settings });
}
