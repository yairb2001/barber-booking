import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPaySig } from "@/lib/billing/pay-link";
import { createStandingOrderLink, isConfigured } from "@/lib/billing/invoice4u";
import { getPlans, planKeyOf } from "@/lib/crm/plans";
import { recordCrmNotification } from "@/lib/crm/notify";

export const dynamic = "force-dynamic";

/**
 * POST { slug, sig, name, email } from the /pay page → Invoice4U's card page
 * for a monthly standing order at the plan price. Until Invoice4U is
 * connected: { pending: true } and Yair hears that this owner wants to pay
 * (once a day), so nobody is locked out for lack of a working link.
 */
const parse = (raw: string | null | undefined): Record<string, unknown> => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };

export async function POST(req: NextRequest) {
  const { slug, sig, name, email } = await req.json().catch(() => ({}));
  const biz = typeof slug === "string" ? await prisma.business.findUnique({ where: { slug }, select: { id: true, name: true, phone: true, settings: true, paidAt: true, monthlyPrice: true } }) : null;
  if (!biz || !verifyPaySig(biz.id, String(sig ?? ""))) return NextResponse.json({ error: "הקישור לא תקין" }, { status: 404 });
  if (biz.paidAt) return NextResponse.json({ paid: true });
  const mail = typeof email === "string" ? email.trim() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return NextResponse.json({ error: "נא להזין מייל תקין, לשם יישלחו החשבוניות" }, { status: 400 });
  const fullName = typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : biz.name;

  const s = parse(biz.settings);
  s.billingEmail = mail;
  if (!s.ownerName && fullName !== biz.name) s.ownerName = fullName;
  const plan = (await getPlans()).find(p => p.key === planKeyOf(biz.settings)) ?? null;
  const amount = plan?.priceIls ?? biz.monthlyPrice ?? 0;

  if (!isConfigured() || amount <= 0) {
    const last = typeof s.payPendingAt === "string" ? new Date(s.payPendingAt).getTime() : 0;
    if (Date.now() - last > 24 * 3600_000) {
      s.payPendingAt = new Date().toISOString();
      await recordCrmNotification(`${biz.name} רוצה להזין כרטיס ולהמשיך${plan ? ` (מסלול ${plan.name}, ${plan.priceIls} ₪)` : ""}\n${amount <= 0 ? "אין לו מסלול עם מחיר." : "הסליקה עוד לא מחוברת."} מייל: ${mail}`, { kind: "customer", businessId: biz.id, push: true });
    }
    await prisma.business.update({ where: { id: biz.id }, data: { settings: JSON.stringify(s) } });
    return NextResponse.json({ pending: true });
  }

  await prisma.business.update({ where: { id: biz.id }, data: { settings: JSON.stringify(s) } });
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  let ownerPhone = biz.phone ?? "";
  if (typeof s.ownerLoginPhone === "string") ownerPhone = s.ownerLoginPhone;
  try {
    const url = await createStandingOrderLink({ origin, businessId: biz.id, fullName, email: mail, phone: ownerPhone, amountIls: amount, itemName: `צ'אטור, מסלול ${plan?.name ?? ""} (חודשי)`.replace(" ()", "") });
    return NextResponse.json({ url });
  } catch (e) {
    console.error("[pay] standing order link", e);
    await recordCrmNotification(`${biz.name}: דף התשלום לא נפתח\n${e instanceof Error ? e.message : "שגיאה"}`, { kind: "system", businessId: biz.id, push: true });
    return NextResponse.json({ error: "דף התשלום לא נפתח כרגע. קיבלנו התראה ונחזור אליך." }, { status: 502 });
  }
}
