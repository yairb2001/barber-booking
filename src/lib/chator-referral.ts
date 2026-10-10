/**
 * Chator "חבר מביא חבר" between SHOPS (11.10.2026, Yair: "חבר מביא חבר, חודש חינם זה מקנה").
 * Not the shops' own customer referral program, which is src/lib/referral.ts.
 *
 * A shop's personal link is /signup?ref=<its slug>; a friend who heard about it
 * by word of mouth can type the owner's phone at signup instead. When the
 * friend starts paying (markPaid), the referrer earns one free month: Yair
 * gets a CRM task to give it in Invoice4U (billing is by hand there for now)
 * and marks it applied on the customer card. The friend's own first month is
 * free anyway, like everyone's.
 */
import { prisma } from "@/lib/prisma";
import { recordCrmNotification } from "@/lib/crm/notify";
import { centerNotify } from "@/lib/notify/center";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";

export const REFERRAL_RULE = "על כל מספרה שתביא, כשהיא מתחילה לשלם, אתה מקבל חודש חינם.";
const DEFAULT_NAME = "המספרה שלי";

const digits = (s: string | null | undefined) => (s || "").replace(/\D/g, "");
const localPhone = (s: string | null | undefined) => { const d = digits(s); return d.startsWith("972") ? `0${d.slice(3)}` : d; };
const shopName = (name: string | null | undefined) => (name && name !== DEFAULT_NAME ? name : null);

export function referralLink(slug: string): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
  return `${origin}/signup?ref=${encodeURIComponent(slug)}`;
}

/** The shop behind a ?ref= link, or the shop whose owner has this phone. */
export async function findReferrer(input: { ref?: unknown; phone?: unknown }, excludeId?: string): Promise<{ id: string; name: string; source: "link" | "phone" } | null> {
  const ok = (id: string) => id !== excludeId && id !== DEMO_BUSINESS_ID;
  const ref = typeof input.ref === "string" ? input.ref.trim() : "";
  if (/^[\w-]{2,80}$/.test(ref)) {
    const b = await prisma.business.findUnique({ where: { slug: ref }, select: { id: true, name: true } });
    if (b && ok(b.id)) return { ...b, source: "link" };
  }
  const p = localPhone(typeof input.phone === "string" ? input.phone : "");
  if (/^05\d{8}$/.test(p)) {
    const intl = `972${p.slice(1)}`;
    const cands = await prisma.business.findMany({
      where: { OR: [{ phone: { in: [p, intl, `+${intl}`] } }, { settings: { contains: p } }, { settings: { contains: intl } }] },
      select: { id: true, name: true, phone: true, settings: true }, take: 10,
    });
    const hit = cands.find(b => {
      if (!ok(b.id)) return false;
      if (localPhone(b.phone) === p) return true;
      try { return localPhone(JSON.parse(b.settings || "{}").ownerLoginPhone) === p; } catch { return false; }
    });
    if (hit) return { id: hit.id, name: hit.name, source: "phone" };
  }
  return null;
}

/** Called once, right after the friend's business is created. */
export async function recordReferral(referred: { id: string; name: string }, referrer: { id: string; name: string; source: "link" | "phone" }): Promise<void> {
  try {
    await prisma.businessReferral.create({ data: { referrerId: referrer.id, referredId: referred.id, source: referrer.source } });
  } catch { return; } // already recorded
  const friend = shopName(referred.name);
  await centerNotify({
    businessId: referrer.id, kind: "account",
    title: friend ? `${friend} נרשמו דרכך` : "מספרה חדשה נרשמה דרכך",
    body: "כשהם יתחילו לשלם, תקבל חודש חינם.",
    href: "/admin/settings/plan#referral",
  }).catch(() => {});
}

/** The friend became a paying customer: the referrer earns his free month. Idempotent. */
export async function rewardReferral(referredId: string): Promise<void> {
  try {
    const row = await prisma.businessReferral.findUnique({ where: { referredId } });
    if (!row || row.rewardedAt) return;
    const done = await prisma.businessReferral.updateMany({ where: { id: row.id, rewardedAt: null }, data: { rewardedAt: new Date() } });
    if (!done.count) return;
    const [referrer, referred] = await Promise.all([
      prisma.business.findUnique({ where: { id: row.referrerId }, select: { id: true, name: true } }),
      prisma.business.findUnique({ where: { id: referredId }, select: { name: true } }),
    ]);
    if (!referrer) return;
    const friend = shopName(referred?.name) ?? "המספרה שהביא";
    const text = `חודש חינם ל${referrer.name}: ${friend} התחילו לשלם`;
    await recordCrmNotification(`${text}\nלתת את החודש באינוויס ולסמן בכרטיס הלקוח`, { kind: "customer", businessId: referrer.id, push: true });
    await prisma.crmTask.create({ data: { title: `לתת חודש חינם ל${referrer.name} באינוויס (חבר מביא חבר: ${friend})`, businessId: referrer.id, dueAt: new Date() } });
    await centerNotify({
      businessId: referrer.id, kind: "account",
      title: "קיבלת חודש חינם",
      body: `${friend} התחילו לשלם על צ'אטור. החודש החינמי שלך יירד מהחיוב הבא.`,
      href: "/admin/settings/plan#referral",
    }).catch(() => {});
  } catch (e) {
    console.error("[referral] reward failed", referredId, e);
  }
}

export type ReferralStats = { link: string; friends: { name: string; paying: boolean; at: string }[]; earned: number; applied: number };

export async function referralStats(b: { id: string; slug: string }): Promise<ReferralStats> {
  const rows = await prisma.businessReferral.findMany({ where: { referrerId: b.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const names = new Map((await prisma.business.findMany({ where: { id: { in: rows.map(r => r.referredId) } }, select: { id: true, name: true } })).map(x => [x.id, x.name]));
  return {
    link: referralLink(b.slug),
    friends: rows.map(r => ({ name: shopName(names.get(r.referredId)) ?? "מספרה חדשה", paying: !!r.rewardedAt, at: r.createdAt.toISOString() })),
    earned: rows.filter(r => r.rewardedAt).length,
    applied: rows.filter(r => r.appliedAt).length,
  };
}
