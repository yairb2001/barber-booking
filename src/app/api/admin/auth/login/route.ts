import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyPassword,
  signSession,
  COOKIE_NAME,
  COOKIE_OPTIONS,
} from "@/lib/auth";

/**
 * Unified admin login: phone + password.
 *
 * Resolution order:
 *   1. Try matching the phone against the *owner* (Business.phone or
 *      business.settings.ownerLoginPhone). Verify against Business.passwordHash.
 *   2. Try matching the phone against a Staff record (with passwordHash set).
 *      Verify against Staff.passwordHash.
 *   3. Generic 401 if neither matches.
 *
 * Phone numbers are normalized to digits-only for comparison so that
 * "050-1234567", "0501234567", "972501234567" all match the same record.
 */

function digits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

function phoneMatches(input: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const a = digits(input);
  const b = digits(stored);
  if (!a || !b) return false;
  // Match if one is a suffix of the other (handles +972 vs 0 prefix)
  return a === b || a.endsWith(b) || b.endsWith(a);
}

export async function POST(req: NextRequest) {
  try {
    const { phone, password } = await req.json();

    if (!phone || typeof phone !== "string") {
      return NextResponse.json({ error: "נא להזין טלפון" }, { status: 400 });
    }
    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "נא להזין סיסמה" }, { status: 400 });
    }

    const business = await prisma.business.findFirst();
    if (!business) {
      return NextResponse.json({ error: "לא נמצא עסק" }, { status: 500 });
    }

    // ── Step 1: try owner login (phone matches business public/owner phone) ──
    let ownerLoginPhone: string | null = null;
    if (business.settings) {
      try {
        const s = JSON.parse(business.settings);
        if (typeof s.ownerLoginPhone === "string") ownerLoginPhone = s.ownerLoginPhone;
      } catch { /* ignore */ }
    }

    const matchesOwner =
      phoneMatches(phone, ownerLoginPhone) || phoneMatches(phone, business.phone);

    if (matchesOwner) {
      if (!business.passwordHash) {
        return NextResponse.json(
          { error: "לא הוגדרה סיסמת מנהל ראשי — פנה למפתח" },
          { status: 500 }
        );
      }
      const ok = await verifyPassword(password, business.passwordHash);
      if (!ok) {
        return NextResponse.json({ error: "טלפון או סיסמה שגויים" }, { status: 401 });
      }
      const token = await signSession({ businessId: business.id, role: "owner" });
      const res = NextResponse.json({ ok: true, role: "owner" });
      res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
      return res;
    }

    // ── Step 2: try staff login (look up staff by phone) ──
    // We pull all staff with a passwordHash and compare digits-normalized,
    // since stored phone format may vary.
    const candidates = await prisma.staff.findMany({
      where: { businessId: business.id, passwordHash: { not: null } },
      select: { id: true, phone: true, passwordHash: true, name: true, role: true },
    });

    const staff = candidates.find(s => phoneMatches(phone, s.phone));
    if (!staff || !staff.passwordHash) {
      return NextResponse.json({ error: "טלפון או סיסמה שגויים" }, { status: 401 });
    }

    const ok = await verifyPassword(password, staff.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "טלפון או סיסמה שגויים" }, { status: 401 });
    }

    const token = await signSession({
      businessId: business.id,
      staffId: staff.id,
      role: staff.role === "owner" ? "owner" : "barber",
    });
    const res = NextResponse.json({ ok: true, role: "barber", name: staff.name });
    res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
    return res;
  } catch (e) {
    console.error("login error", e);
    return NextResponse.json({ error: "שגיאה בשרת" }, { status: 500 });
  }
}
