import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";

export const dynamic = "force-dynamic";

// PATCH — update an automation (toggle, edit template/settings)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  // Tenant isolation: only touch an automation that belongs to the caller's business.
  const owned = await prisma.automation.findFirst({ where: { id: params.id, businessId: session.businessId }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.active   !== undefined) data.active   = Boolean(body.active);
  if (body.name     !== undefined) data.name     = String(body.name);
  if (body.template !== undefined) data.template = body.template ?? null;
  if (body.settings !== undefined)
    data.settings = typeof body.settings === "string"
      ? body.settings
      : JSON.stringify(body.settings);

  const automation = await prisma.automation.update({
    where: { id: params.id },
    data,
  });
  return NextResponse.json(automation);
}

// DELETE — remove an automation
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const { count } = await prisma.automation.deleteMany({ where: { id: params.id, businessId: session.businessId } });
  if (count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
