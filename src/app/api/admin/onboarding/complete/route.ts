import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBusiness, requireOwner } from "@/lib/session";

/**
 * POST /api/admin/onboarding/complete — owner marks the onboarding wizard done.
 * Sets `onboardingCompletedAt` so the /admin layout stops redirecting the owner
 * into the wizard. Idempotent (overwrites the timestamp on repeat calls).
 */
export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const business = await getSessionBusiness(req, { id: true });
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  await prisma.business.update({
    where: { id: business.id },
    data: { onboardingCompletedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
