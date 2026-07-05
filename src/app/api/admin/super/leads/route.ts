import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/super-admin";

const STATUSES = ["new", "contacted", "demo", "won", "lost"];

/** GET /api/admin/super/leads — all leads, newest first. */
export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const leads = await prisma.lead.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ leads });
}

/** POST /api/admin/super/leads — manually add a lead. */
export async function POST(req: NextRequest) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!phone) return NextResponse.json({ error: "טלפון חובה" }, { status: 400 });
  const lead = await prisma.lead.create({
    data: {
      phone,
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : null,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
      source: "manual",
      status: STATUSES.includes(body.status) ? body.status : "new",
    },
  });
  return NextResponse.json({ ok: true, lead });
}
