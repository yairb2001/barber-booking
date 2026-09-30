import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/super-admin";
import { createBusinessFromLead } from "@/lib/leads";

const STATUSES = ["new", "contacted", "demo", "won", "lost"];

/** PATCH /api/admin/super/leads/[id] — update status / note / name. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.status === "string" && STATUSES.includes(body.status)) data.status = body.status;
  if (typeof body.note === "string") data.note = body.note.trim() || null;
  if (typeof body.name === "string") data.name = body.name.trim() || null;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "no valid fields" }, { status: 400 });
  let lead = await prisma.lead.update({ where: { id: params.id }, data });
  // "נסגר" → the system does the rest: tenant + personal onboarding link (stage 1, §3).
  let onboarding: { link: string; sent: boolean; created: boolean } | null = null;
  if (data.status === "won" && !lead.businessId) {
    try {
      onboarding = await createBusinessFromLead(lead.id);
      lead = (await prisma.lead.findUnique({ where: { id: lead.id } })) ?? lead;
    } catch (e) { console.error("[leads] create from won lead failed", e); }
  }
  return NextResponse.json({ ok: true, lead, onboarding });
}

/** DELETE /api/admin/super/leads/[id] */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await prisma.lead.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
