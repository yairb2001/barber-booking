import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getEffectivePermissions } from "@/lib/session";
import { getReferralConfig } from "@/lib/referral";
import { GreenApiProvider } from "@/lib/messaging/green-api";
import { SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { getRootBusinessId } from "@/lib/tenant";

// GreenAPI states that mean the bot truly can't send/receive → red banner.
const WA_DOWN_STATES = new Set(["notAuthorized", "blocked", "yellowCard"]);
// How long a recorded WhatsApp state is trusted before we re-probe live.
const WA_STALE_MS = 3 * 60 * 1000;

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

  const business = await prisma.business.findUnique({
    where: { id: session.businessId },
    select: {
      chatsEnabled: true,
      settings: true,
      slug: true,
      tier: true,
      whatsappStatus: true,
      waLiveState: true,
      waCheckedAt: true,
      waDownSince: true,
      messagingProvider: true,
      whatsappNumber: true,
      greenApiInstanceId: true,
      greenApiToken: true,
      onboardingCompletedAt: true,
    },
  });

  // Live WhatsApp connection. The state is normally refreshed by the watchdog
  // cron, on every real send (reconcileWaState), and — to catch an outage even
  // when nothing is being sent — by an opportunistic live probe here. The probe
  // is throttled across ALL admins via waCheckedAt (a single atomic "claim"), so
  // GreenAPI is hit at most once per WA_STALE_MS regardless of how many tabs poll.
  let waState = business?.waLiveState ?? null;
  if (business?.greenApiInstanceId && business?.greenApiToken) {
    const last = business.waCheckedAt?.getTime() ?? 0;
    if (Date.now() - last > WA_STALE_MS) {
      const claim = await prisma.business.updateMany({
        where: {
          id: session.businessId,
          OR: [{ waCheckedAt: null }, { waCheckedAt: { lt: new Date(Date.now() - WA_STALE_MS) } }],
        },
        data: { waCheckedAt: new Date() },
      });
      if (claim.count > 0) {
        try {
          const provider = new GreenApiProvider({
            whatsappNumber: business.whatsappNumber,
            greenApiInstanceId: business.greenApiInstanceId,
            greenApiToken: business.greenApiToken,
          });
          const res = await provider.getState();
          if (res.ok && res.state) {
            waState = res.state;
            const isDown = WA_DOWN_STATES.has(res.state);
            await prisma.business.update({
              where: { id: session.businessId },
              data: {
                waLiveState: res.state,
                waDownSince: isDown ? (business.waDownSince ?? new Date()) : null,
              },
            });
          }
        } catch {
          // Probe is best-effort — fall back to the last recorded state.
        }
      }
    }
  }
  const whatsappDown = waState === "notAuthorized" || waState === "blocked" || waState === "yellowCard";

  // Effective permissions: owner = all; barber = per-staff flag OR business-wide flag.
  const perms = await getEffectivePermissions(req);

  const rootBusinessId = await getRootBusinessId();
  const isRootBusiness = session.businessId === rootBusinessId;
  const slug = business?.slug ?? null;
  const publicPath = isRootBusiness || !slug ? "/" : `/${slug}`;

  return NextResponse.json({
    businessId: session.businessId,
    isRootBusiness,
    publicPath,
    role: session.role,
    isOwner: session.isOwner,
    isSuperAdmin: session.isOwner && session.businessId === SUPER_ADMIN_BUSINESS_ID,
    impersonating: !!req.cookies.get("super_origin")?.value,
    staffId: session.staffId || null,
    staff,
    chatsEnabled: business?.chatsEnabled ?? false,
    slug: business?.slug ?? null,
    tier: business?.tier ?? "basic",
    whatsappStatus: business?.whatsappStatus ?? "not_requested",
    waLiveState: waState,
    whatsappDown,
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
