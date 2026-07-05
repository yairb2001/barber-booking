import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/super-admin";

/**
 * GET /api/admin/super
 *
 * Platform control-room payload: headline stats + the activation funnel + the
 * full list of tenant businesses with activity/billing. Gated to the platform
 * owner only.
 */
export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [businesses, staffGroups, apptGroups, custGroups, msgMaxGroups, openLeads] =
    await Promise.all([
      prisma.business.findMany({
        select: {
          id: true, name: true, slug: true, tier: true, phone: true, settings: true,
          monthlyPrice: true, setupFee: true, paidAt: true, suspendedAt: true,
          trialEndsAt: true, whatsappStatus: true, waLiveState: true, createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.staff.groupBy({ by: ["businessId"], _count: { _all: true } }),
      prisma.appointment.groupBy({ by: ["businessId"], _count: { _all: true } }),
      prisma.customer.groupBy({ by: ["businessId"], _count: { _all: true } }),
      prisma.messageLog.groupBy({ by: ["businessId"], _max: { createdAt: true } }),
      prisma.lead.count({ where: { status: { in: ["new", "contacted", "demo"] } } }),
    ]);

  const staffMap = new Map(staffGroups.map((g) => [g.businessId, g._count._all]));
  const apptMap  = new Map(apptGroups.map((g) => [g.businessId, g._count._all]));
  const custMap  = new Map(custGroups.map((g) => [g.businessId, g._count._all]));
  const lastMsgMap = new Map(msgMaxGroups.map((g) => [g.businessId, g._max.createdAt]));

  function ownerPhone(settings: string | null, phone: string | null): string | null {
    if (settings) {
      try {
        const s = JSON.parse(settings);
        if (typeof s.ownerLoginPhone === "string") return s.ownerLoginPhone;
      } catch { /* ignore */ }
    }
    return phone;
  }

  const rows = businesses.map((b) => {
    const staffCount = staffMap.get(b.id) ?? 0;
    const apptCount = apptMap.get(b.id) ?? 0;
    const activated = staffCount > 0 && apptCount > 0;
    const paying = !!b.paidAt && !b.suspendedAt;
    const trialActive = !b.paidAt && !!b.trialEndsAt && b.trialEndsAt > now;
    const trialDaysLeft = b.trialEndsAt
      ? Math.ceil((b.trialEndsAt.getTime() - now.getTime()) / 86400000)
      : null;
    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
      tier: b.tier,
      ownerPhone: ownerPhone(b.settings, b.phone),
      monthlyPrice: b.monthlyPrice ?? null,
      setupFee: b.setupFee ?? null,
      paidAt: b.paidAt,
      suspendedAt: b.suspendedAt,
      trialEndsAt: b.trialEndsAt,
      trialDaysLeft,
      whatsappStatus: b.whatsappStatus,
      waLiveState: b.waLiveState,
      createdAt: b.createdAt,
      staffCount,
      apptCount,
      customerCount: custMap.get(b.id) ?? 0,
      lastActivityAt: lastMsgMap.get(b.id) ?? null,
      activated,
      paying,
      trialActive,
      suspended: !!b.suspendedAt,
    };
  });

  const stats = {
    total: rows.length,
    activated: rows.filter((r) => r.activated).length,
    paying: rows.filter((r) => r.paying).length,
    onTrial: rows.filter((r) => r.trialActive && !r.paying).length,
    newThisMonth: rows.filter((r) => r.createdAt >= monthStart).length,
    mrr: rows.filter((r) => r.paying).reduce((sum, r) => sum + (r.monthlyPrice ?? 0), 0),
    openLeads,
    // Activation funnel
    funnel: {
      signedUp: rows.length,
      activated: rows.filter((r) => r.activated).length,
      paying: rows.filter((r) => r.paying).length,
    },
  };

  return NextResponse.json({ stats, businesses: rows });
}
