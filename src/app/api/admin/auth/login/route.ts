import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyPassword,
  signSession,
  COOKIE_NAME,
  COOKIE_OPTIONS,
} from "@/lib/auth";

/**
 * Unified admin login: phone + password. MULTI-TENANT.
 *
 * There can be many businesses. We must NOT assume the first one — we search
 * across all tenants for a phone+password that verifies.
 *
 * Resolution order:
 *   1. OWNER: find every business whose owner phone (Business.phone or
 *      settings.ownerLoginPhone) matches the input, then pick the one whose
 *      Business.passwordHash verifies the password.
 *   2. STAFF: find every staff (across all businesses) with a passwordHash whose
 *      phone matches, then pick the one whose Staff.passwordHash verifies.
 *   3. Generic 401 if neither matches.
 *
 * Phone numbers are normalized to digits-only for comparison so that
 * "050-1234567", "0501234567", "972501234567" all match the same record.
 * Phone matching is suffix-based, so two tenants could share a phone match —
 * that's why we ALWAYS confirm via password verification before issuing a session.
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

    // ── Step 1: try OWNER login across ALL businesses ──
    // A business owns the login when its public/owner phone matches AND its
    // passwordHash verifies. We scan every business that has a passwordHash set.
    const ownerCandidates = await prisma.business.findMany({
      where: { passwordHash: { not: null } },
      select: { id: true, phone: true, passwordHash: true, settings: true },
    });

    for (const biz of ownerCandidates) {
      let ownerLoginPhone: string | null = null;
      if (biz.settings) {
        try {
          const s = JSON.parse(biz.settings);
          if (typeof s.ownerLoginPhone === "string") ownerLoginPhone = s.ownerLoginPhone;
        } catch { /* ignore */ }
      }
      const matchesOwner =
        phoneMatches(phone, ownerLoginPhone) || phoneMatches(phone, biz.phone);
      if (!matchesOwner || !biz.passwordHash) continue;

      const ok = await verifyPassword(password, biz.passwordHash);
      if (!ok) continue; // phone matched but wrong password for this tenant — keep scanning

      const token = await signSession({ businessId: biz.id, role: "owner" });
      const res = NextResponse.json({ ok: true, role: "owner" });
      res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
      return res;
    }

    // ── Step 2: try STAFF login across ALL businesses ──
    // Pull every staff with a passwordHash and compare digits-normalized,
    // since stored phone format may vary. Confirm by verifying the password.
    const staffCandidates = await prisma.staff.findMany({
      where: { passwordHash: { not: null } },
      select: { id: true, businessId: true, phone: true, passwordHash: true, name: true, role: true },
    });

    for (const staff of staffCandidates) {
      if (!phoneMatches(phone, staff.phone) || !staff.passwordHash) continue;
      const ok = await verifyPassword(password, staff.passwordHash);
      if (!ok) continue;

      const token = await signSession({
        businessId: staff.businessId,
        staffId: staff.id,
        role: staff.role === "owner" ? "owner" : "barber",
      });
      const res = NextResponse.json({ ok: true, role: "barber", name: staff.name });
      res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
      return res;
    }

    return NextResponse.json({ error: "טלפון או סיסמה שגויים" }, { status: 401 });
  } catch (e) {
    console.error("login error", e);
    return NextResponse.json({ error: "שגיאה בשרת" }, { status: 500 });
  }
}
