import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, signSession, COOKIE_NAME, COOKIE_OPTIONS } from "@/lib/auth";
import { generateSlug } from "@/lib/tenant";
import { notifyPlatformOwner } from "@/lib/super-admin";
import { isBusinessType, DEFAULT_BUSINESS_TYPE } from "@/lib/vocab";
import { getPlans } from "@/lib/crm/plans";
import { FREE_FIRST_MONTH_DAYS } from "@/lib/leads";
import { findReferrer, recordReferral } from "@/lib/chator-referral";

/**
 * Self-service signup — creates a NEW business (tenant) and logs the owner in.
 *
 * Public endpoint (lives outside /api/admin, so the auth middleware doesn't
 * guard it). Owner identity is keyed to the Business itself (Business.passwordHash
 * + settings.ownerLoginPhone) — matching the login model in
 * src/app/api/admin/auth/login/route.ts.
 *
 * The owner is NOT seeded as a Staff row here. Instead, right after signup the
 * owner is sent to the onboarding wizard (/admin/onboarding), where THEY set up
 * their own barber profile, weekly calendar and first service — so those choices
 * are configured in the flow, not silently hardcoded. The wizard pre-fills
 * sensible defaults so it's mostly a confirm-and-continue.
 *
 * New businesses start on the BASIC tier with a 14-day trial and no WhatsApp
 * connected (whatsappStatus = "not_requested"). They can take bookings once the
 * wizard's barber+service steps are done; WhatsApp reminders stay muted until
 * GreenAPI is provisioned.
 */

function digits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}
function phoneMatches(input: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const a = digits(input), b = digits(stored);
  if (!a || !b) return false;
  return a === b || a.endsWith(b) || b.endsWith(a);
}

// A free first month for everyone (Yair, 10.10.2026: "30 ניסיון ללא עלות"),
// same rule as a business opened from the CRM (src/lib/leads.ts).
const TRIAL_DAYS = FREE_FIRST_MONTH_DAYS;

export async function POST(req: NextRequest) {
  try {
    const { businessName, phone, password, confirmPassword, businessType: rawType, planKey, ref, referrerPhone } = await req.json();
    const businessType = isBusinessType(rawType) ? rawType : DEFAULT_BUSINESS_TYPE;

    // The shop's name is optional at signup (Yair, 10.10.2026); the wizard asks for it.
    // The free month runs on the shop's own WhatsApp (regular, by QR), so the
    // shop needs a mobile number (10.10.2026). Israeli mobile: 05XXXXXXXX / 9725XXXXXXXX.
    if (!phone || typeof phone !== "string" || !/^(05\d{8}|9725\d{8})$/.test(digits(phone))) {
      return NextResponse.json({ error: "צריך מספר נייד של המספרה (מתחיל ב־05). זה גם המספר שהסוכן יענה ממנו בוואטסאפ." }, { status: 400 });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json({ error: "סיסמה חייבת להיות לפחות 6 תווים" }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: "הסיסמאות לא תואמות" }, { status: 400 });
    }

    // Reject if this phone is already an OWNER login of an existing business —
    // owner login matches by phone, so two businesses sharing an owner phone
    // would be ambiguous. (A staff phone in another business is fine.)
    const owners = await prisma.business.findMany({
      where: { passwordHash: { not: null } },
      select: { phone: true, settings: true },
    });
    const phoneTaken = owners.some((b) => {
      let ownerLoginPhone: string | null = null;
      if (b.settings) {
        try {
          const s = JSON.parse(b.settings);
          if (typeof s.ownerLoginPhone === "string") ownerLoginPhone = s.ownerLoginPhone;
        } catch { /* ignore */ }
      }
      return phoneMatches(phone, b.phone) || phoneMatches(phone, ownerLoginPhone);
    });
    if (phoneTaken) {
      return NextResponse.json(
        { error: "מספר הטלפון כבר רשום במערכת. נסה להתחבר במקום זאת." },
        { status: 409 }
      );
    }

    const name = typeof businessName === "string" && businessName.trim().length >= 2 ? businessName.trim() : "המספרה שלי";
    const slug = await generateSlug(name);
    const passwordHash = await hashPassword(password);
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    // The plan picked at signup (10.10.2026): a WhatsApp message quota that
    // fits his estimated appointments. Billing starts after the trial.
    const plan = typeof planKey === "string" ? (await getPlans()).find(p => p.key === planKey && p.active) ?? null : null;

    const business = await prisma.business.create({
      data: {
        name,
        slug,
        phone,
        passwordHash,
        businessType,
        tier: "basic",
        trialEndsAt,
        whatsappStatus: "not_requested",
        messagingProvider: "evolution", evolutionInstance: slug, // our WhatsApp server; device is created on first QR
        settings: JSON.stringify({ ownerLoginPhone: phone, ...(plan ? { planKey: plan.key, tokenBudgetIls: plan.aiBudgetIls } : {}) }),
        ...(plan ? { monthlyPrice: plan.priceIls } : {}),
      },
      select: { id: true, slug: true },
    });

    // "חבר מביא חבר" (11.10.2026): his link, or the phone of the owner who told him.
    const referrer = await findReferrer({ ref, phone: referrerPhone }, business.id);
    if (referrer) await recordReferral({ id: business.id, name }, referrer);

    await notifyPlatformOwner(`\u{1F389} \u05d4\u05e8\u05e9\u05de\u05d4 \u05d7\u05d3\u05e9\u05d4!\n\u05e2\u05e1\u05e7: ${name}\n\u05d8\u05dc\u05e4\u05d5\u05df: ${phone}${plan ? `\n\u05de\u05e1\u05dc\u05d5\u05dc: ${plan.name}` : ""}${referrer ? `\nבהמלצה של: ${referrer.name}` : ""}`, { kind: "customer", businessId: business.id, push: false });

    const token = await signSession({ businessId: business.id, role: "owner" });
    const res = NextResponse.json({ ok: true, slug: business.slug });
    res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
    return res;
  } catch (e) {
    console.error("signup error", e);
    return NextResponse.json({ error: "שגיאה בהרשמה. נסה שוב." }, { status: 500 });
  }
}
