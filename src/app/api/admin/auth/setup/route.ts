import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  signSession,
  COOKIE_NAME,
  COOKIE_OPTIONS,
} from "@/lib/auth";

/**
 * First-run setup: set the initial owner password when none exists.
 *
 * Security model:
 *   - Allowed only when Business.passwordHash is null (one-shot setup).
 *   - Caller must provide the phone number that matches Business.phone OR
 *     business.settings.ownerLoginPhone — this binds the password to the
 *     legitimate owner of the business record.
 *   - Once a password is set, this endpoint will return 400 forever.
 *     Future password changes go through /change-password (which requires
 *     the existing password).
 *
 * After successful setup the user is auto-logged-in (session cookie set).
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

export async function POST(req: NextRequest) {
  try {
    const { phone, password, confirmPassword } = await req.json();

    if (!phone || typeof phone !== "string") {
      return NextResponse.json({ error: "נא להזין טלפון" }, { status: 400 });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "סיסמה חייבת להיות לפחות 6 תווים" },
        { status: 400 }
      );
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: "הסיסמאות לא תואמות" }, { status: 400 });
    }

    const business = await prisma.business.findFirst();
    if (!business) {
      return NextResponse.json({ error: "לא נמצא עסק" }, { status: 500 });
    }

    // Already set — refuse (the owner should use /change-password instead)
    if (business.passwordHash) {
      return NextResponse.json(
        { error: "הסיסמה כבר הוגדרה. להחלפה — היכנס לחשבון והשתמש בהגדרות." },
        { status: 400 }
      );
    }

    // Verify the phone matches the business — prevents random visitors from
    // claiming the password even if they happen to find this URL.
    let ownerLoginPhone: string | null = null;
    if (business.settings) {
      try {
        const s = JSON.parse(business.settings);
        if (typeof s.ownerLoginPhone === "string") ownerLoginPhone = s.ownerLoginPhone;
      } catch { /* ignore */ }
    }
    const matchesPhone =
      phoneMatches(phone, business.phone) || phoneMatches(phone, ownerLoginPhone);
    if (!matchesPhone) {
      return NextResponse.json(
        { error: "הטלפון לא מתאים לעסק. נסה שוב או פנה לתמיכה." },
        { status: 401 }
      );
    }

    // Set password and auto-login
    const hash = await hashPassword(password);
    await prisma.business.update({
      where: { id: business.id },
      data: { passwordHash: hash },
    });

    const token = await signSession({ businessId: business.id, role: "owner" });
    const res = NextResponse.json({ ok: true, role: "owner" });
    res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
    return res;
  } catch (e) {
    console.error("setup error", e);
    return NextResponse.json({ error: "שגיאה בשרת" }, { status: 500 });
  }
}
