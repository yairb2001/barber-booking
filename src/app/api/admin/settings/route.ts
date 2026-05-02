import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";

// GET /api/admin/settings — readable by all authenticated admins/barbers
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await prisma.business.findFirst({
    select: { id: true, settings: true },
  });
  if (!business) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    id: business.id,
    settings: business.settings ?? null,
  });
}

// PATCH /api/admin/settings — owner only
export async function PATCH(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const body = await req.json();
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "not found" }, { status: 404 });

  const existing = (() => {
    try { return business.settings ? JSON.parse(business.settings) : {}; } catch { return {}; }
  })();

  const updated = await prisma.business.update({
    where: { id: business.id },
    data: { settings: JSON.stringify({ ...existing, ...body }) },
  });

  return NextResponse.json({ ok: true, settings: updated.settings });
}
