import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyPassword,
  signSession,
  COOKIE_NAME,
  COOKIE_OPTIONS,
} from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { password, phone } = await req.json();

    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "נא להזין סיסמה" }, { status: 400 });
    }

    const business = await prisma.business.findFirst();
    if (!business) {
      return NextResponse.json({ error: "לא נמצא עסק" }, { status: 500 });
    }

    // ── Option 1: staff login (phone + password) ──────────────────────────────
    if (phone && typeof phone === "string") {
      const staff = await prisma.staff.findFirst({
        where: { businessId: business.id, phone },
      });
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
    }

    // ── Option 2: owner login (password only) ─────────────────────────────────
    if (!business.passwordHash) {
      return NextResponse.json(
        { error: "לא הוגדרה סיסמה — פנה למפתח" },
        { status: 500 }
      );
    }
    const ok = await verifyPassword(password, business.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "סיסמה שגויה" }, { status: 401 });
    }
    const token = await signSession({ businessId: business.id, role: "owner" });
    const res = NextResponse.json({ ok: true, role: "owner" });
    res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
    return res;
  } catch (e) {
    console.error("login error", e);
    return NextResponse.json({ error: "שגיאה בשרת" }, { status: 500 });
  }
}
