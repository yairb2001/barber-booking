import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getEffectivePermissions } from "@/lib/session";
import { getReferralConfig } from "@/lib/referral";

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let staff: { id: string; name: string; role: string } | null = null;
  if (session.staffId) {
    const s = await prisma.staff.findUnique({
      where: { id: session.staffId },
      select: { id: true, name: true, role: true },
    });
    if (s) staff = s;
  }

  const business = await prisma.business.findFirst({
    where: { id: session.businessId },
    select: {
      chatsEnabled: true,
      settings: true,
      slug: true,
      tier: true,
      whatsappStatus: true,
      onboardingCompletedAt: true,
    },
  });

  // Effective permissions: owner = all; barber = per-staff flag OR business-wide flag.
  const perms = await getEffectivePermissions(req);

  return NextResponse.json({
    businessId: session.businessId,
    role: session.role,
    isOwner: session.isOwner,
    staffId: session.staffId || null,
    staff,
    chatsEnabled: business?.chatsEnabled ?? false,
    slug: business?.slug ?? null,
    tier: business?.tier ?? "basic",
    whatsappStatus: business?.whatsappStatus ?? "not_requested",
    onboardingCompletedAt: business?.onboardingCompletedAt ?? null,
    // Effective per-user permissions (the values the UI should gate on).
    canViewAllCalendars: perms.canViewAllCalendars,
    canViewAllChats: perms.canViewAllChats,
    // Backward-compatible field names — now reflect the EFFECTIVE permission
    // (per-staff OR business-wide), so existing UI gating keeps working.
    barbersCanViewOthersCalendar: perms.canViewAllCalendars,
    barbersCanAccessChats: perms.canViewAllChats,
    referralProgramEnabled: getReferralConfig(business?.settings ?? null).enabled,
  });
}
