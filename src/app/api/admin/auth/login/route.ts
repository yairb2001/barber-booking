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
    const { password } = await req.json();

    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "נא להזין סיסמה" }, { status: 400 });
    }

    // Single-tenant for now: use first business
    const business = await prisma.business.findFirst();
    if (!business) {
      return NextResponse.json({ error: "לא נמצא עסק" }, { status: 500 });
    }

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

    const token = await signSession(business.id);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
    return res;
  } catch (e) {
    console.error("login error", e);
    return NextResponse.json({ error: "שגיאה בשרת" }, { status: 500 });
  }
}
