import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, barbersCanSeeAllCustomers } from "@/lib/session";
import { getReferralConfig, tiersUnlockedFor } from "@/lib/referral";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/referrals/[id]/mark-given
 *
 * Marks the NEXT still-owed referral reward tier as physically handed to this
 * customer (the referrer). Same "who can touch this" scoping as the referrals
 * list itself — referrals are business-wide, not per-barber.
 *
 * Idempotent-ish: bounded by how many tiers the customer's referral count has
 * actually unlocked, so repeated clicks (or a stale UI) can't push the given
 * count past what's genuinely earned.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await prisma.business.findUnique({
    where: { id: session.businessId },
    select: { settings: true },
  });
  if (!session.isOwner && !barbersCanSeeAllCustomers(business?.settings ?? null)) {
    return NextResponse.json({ error: "פעולה זו זמינה למנהל ראשי בלבד" }, { status: 403 });
  }

  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    select: { id: true, businessId: true, referralTiersGiven: true },
  });
  if (!customer || customer.businessId !== session.businessId) {
    return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  }

  const referralCount = await prisma.customer.count({
    where: { businessId: session.businessId, referredById: customer.id },
  });
  const config = getReferralConfig(business?.settings ?? null);
  const unlocked = tiersUnlockedFor(referralCount, config);

  if (customer.referralTiersGiven >= unlocked) {
    return NextResponse.json({ error: "אין עוד מתנה שממתינה ללקוח הזה" }, { status: 400 });
  }

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { referralTiersGiven: customer.referralTiersGiven + 1 },
    select: { referralTiersGiven: true },
  });

  return NextResponse.json({ ok: true, tiersGiven: updated.referralTiersGiven });
}
