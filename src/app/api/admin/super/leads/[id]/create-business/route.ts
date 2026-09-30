import { NextRequest, NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/super-admin";
import { createBusinessFromLead } from "@/lib/leads";

/**
 * POST /api/admin/super/leads/[id]/create-business
 * "צור עסק מליד": creates the tenant from the lead (once) and sends / re-sends
 * the owner's personal onboarding link on WhatsApp. Returns the link too, so
 * Yair can forward it himself if the send failed.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const r = await createBusinessFromLead(params.id);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}
