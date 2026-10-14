import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { activateBusiness } from "@/lib/activation";
import { prisma } from "@/lib/prisma";

/** The owner's "הפעל": the shop goes live and the free month starts now (13.10.2026). */
export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });
  const r = await activateBusiness(biz.id, "button");
  // Live = the agent answers customers (until now it answered only the tester).
  if (r.activated) await prisma.agentConfig.updateMany({ where: { businessId: biz.id }, data: { isEnabled: true } });
  return NextResponse.json({ ok: true, trialEndsAt: r.trialEndsAt });
}
