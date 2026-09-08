import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, barbersCanSeeAllCustomers } from "@/lib/session";
import { getReferralConfig, getReferralProgress, tiersUnlockedFor } from "@/lib/referral";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/referrals
 *
 * Powers the "חבר מביא חבר" admin tab. Returns every customer who has referred
 * at least one friend, how many they've brought, and which gifts are now owed.
 *
 * Available to ANY logged-in admin (owner OR barber) — referrals are a
 * business-wide program, not scoped to a single barber.
 */
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await prisma.business.findUnique({
    where: { id: session.businessId },
    select: { settings: true },
  });

  // This tab exposes the whole shop's customer + referrer contact list. When the
  // owner has turned OFF "barbers can see all customers", a barber must not get
  // it here either (matches the scoping in /api/admin/customers).
  if (!session.isOwner && !barbersCanSeeAllCustomers(business?.settings ?? null)) {
    return NextResponse.json({ error: "פעולה זו זמינה למנהל ראשי בלבד" }, { status: 403 });
  }

  const config = getReferralConfig(business?.settings ?? null);

  // All referred customers (those with a referrer set), newest first.
  const referred = await prisma.customer.findMany({
    where: { businessId: session.businessId, referredById: { not: null }, deletedAt: null },
    select: { id: true, name: true, createdAt: true, referredById: true },
    orderBy: { createdAt: "desc" },
  });

  // Group the referred friends under each referrer.
  const byReferrer = new Map<string, { name: string; createdAt: Date }[]>();
  for (const r of referred) {
    const key = r.referredById!;
    if (!byReferrer.has(key)) byReferrer.set(key, []);
    byReferrer.get(key)!.push({ name: r.name, createdAt: r.createdAt });
  }

  // Load the referrer customers themselves (name + phone so the owner can reach them).
  const referrerIds = Array.from(byReferrer.keys());
  const referrers = referrerIds.length
    ? await prisma.customer.findMany({
        where: { id: { in: referrerIds } },
        select: { id: true, name: true, phone: true, referralTiersGiven: true },
      })
    : [];
  const referrerMap = new Map(referrers.map(c => [c.id, c]));

  const rows = referrerIds
    .map(id => {
      const friends = byReferrer.get(id)!;
      const ref = referrerMap.get(id);
      const count = friends.length;
      // How many reward tiers this count has unlocked vs. how many the admin
      // has actually marked as given — the gap is what's still owed. With no
      // tier 2 configured this is the old "repeat every `goal`" behavior;
      // with one configured, tiers cap at 2 (nothing past tier 2 to unlock).
      const unlocked = tiersUnlockedFor(count, config);
      const given = ref?.referralTiersGiven ?? 0;
      const owed = Math.max(0, unlocked - given);
      // Explicit list of which reward(s) are still owed, in order — with a
      // tier 2 configured, tier 1 and tier 2 are DIFFERENT rewards (can't just
      // say "2 × giftLabel"); without one, this is N copies of the same
      // repeating giftLabel, exactly like before tiers existed.
      const pendingLabels: string[] = [];
      for (let t = given + 1; t <= unlocked; t++) {
        pendingLabels.push(config.goal2 && t >= 2 ? (config.giftLabel2 || config.giftLabel) : config.giftLabel);
      }
      const progress = getReferralProgress(count, config);
      return {
        id,
        name: ref?.name ?? "לקוח",
        phone: ref?.phone ?? "",
        count,
        tiersGiven: given,
        giftsEarned: owed,
        pendingLabels,
        towardNext: Math.min(count, progress.goal),
        activeGoal: progress.goal,
        reached: unlocked > 0,
        friends: friends.map(f => ({ name: f.name, date: f.createdAt })),
      };
    })
    .sort((a, b) => b.count - a.count);

  const owedCount = rows.reduce((s, r) => s + r.giftsEarned, 0);

  return NextResponse.json({
    enabled: config.enabled,
    goal: config.goal,
    giftLabel: config.giftLabel,
    goal2: config.goal2,
    giftLabel2: config.giftLabel2,
    totalReferrers: rows.length,
    totalReferred: referred.length,
    owedCount,
    rows,
  });
}
