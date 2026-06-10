import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, signSession, COOKIE_NAME, COOKIE_OPTIONS } from "@/lib/auth";
import { generateSlug } from "@/lib/tenant";

/**
 * Self-service signup — creates a NEW business (tenant) and logs the owner in.
 *
 * Public endpoint (lives outside /api/admin, so the auth middleware doesn't
 * guard it). Owner identity is keyed to the Business itself (Business.passwordHash
 * + settings.ownerLoginPhone) — matching the login model in
 * src/app/api/admin/auth/login/route.ts. The owner is NOT a Staff row; the first
 * barber is created later in the onboarding wizard.
 *
 * New businesses start on the BASIC tier with a 14-day trial and no WhatsApp
 * connected (whatsappStatus = "not_requested"). They can take bookings
 * immediately; WhatsApp reminders stay muted until GreenAPI is provisioned.
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

const TRIAL_DAYS = 14;

export async function POST(req: NextRequest) {
  try {
    const { businessName, phone, password, confirmPassword } = await req.json();

    if (!businessName || typeof businessName !== "string" || businessName.trim().length < 2) {
      return NextResponse.json({ error: "נא להזין שם עסק" }, { status: 400 });
    }
    if (!phone || typeof phone !== "string" || digits(phone).length < 9) {
      return NextResponse.json({ error: "נא להזין מספר טלפון תקין" }, { status: 400 });
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

    const name = businessName.trim();
    const slug = await generateSlug(name);
    const passwordHash = await hashPassword(password);
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const business = await prisma.business.create({
      data: {
        name,
        slug,
        phone,
        passwordHash,
        tier: "basic",
        trialEndsAt,
        whatsappStatus: "not_requested",
        settings: JSON.stringify({ ownerLoginPhone: phone }),
      },
      select: { id: true, slug: true },
    });

    const token = await signSession({ businessId: business.id, role: "owner" });
    const res = NextResponse.json({ ok: true, slug: business.slug });
    res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
    return res;
  } catch (e) {
    console.error("signup error", e);
    return NextResponse.json({ error: "שגיאה בהרשמה. נסה שוב." }, { status: 500 });
  }
}
