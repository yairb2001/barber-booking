import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { getRequestSession } from "@/lib/session";

/**
 * Change password — requires the current password for verification.
 * Works for both owner and staff. The session decides which record to update:
 *   - role=owner, no staffId → updates Business.passwordHash
 *   - role=barber, has staffId → updates Staff.passwordHash for that staff
 *
 * Body: { oldPassword: string, newPassword: string, confirmPassword: string }
 */
export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { oldPassword, newPassword, confirmPassword } = await req.json();

  if (!oldPassword || typeof oldPassword !== "string") {
    return NextResponse.json({ error: "נא להזין את הסיסמה הנוכחית" }, { status: 400 });
  }
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
    return NextResponse.json(
      { error: "הסיסמה החדשה חייבת להיות לפחות 6 תווים" },
      { status: 400 }
    );
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "הסיסמאות החדשות לא תואמות" }, { status: 400 });
  }
  if (oldPassword === newPassword) {
    return NextResponse.json(
      { error: "הסיסמה החדשה זהה לישנה — נא לבחור סיסמה אחרת" },
      { status: 400 }
    );
  }

  // ── Owner — update Business.passwordHash ──
  if (session.isOwner && !session.staffId) {
    const business = await prisma.business.findUnique({
      where: { id: session.businessId },
      select: { passwordHash: true },
    });
    if (!business?.passwordHash) {
      return NextResponse.json(
        { error: "לא נמצאה סיסמה מוגדרת — פנה לתמיכה" },
        { status: 500 }
      );
    }
    const ok = await verifyPassword(oldPassword, business.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "הסיסמה הנוכחית שגויה" }, { status: 401 });
    }
    const newHash = await hashPassword(newPassword);
    await prisma.business.update({
      where: { id: session.businessId },
      data: { passwordHash: newHash },
    });
    return NextResponse.json({ ok: true });
  }

  // ── Staff — update Staff.passwordHash ──
  if (session.staffId) {
    const staff = await prisma.staff.findUnique({
      where: { id: session.staffId },
      select: { passwordHash: true },
    });
    if (!staff?.passwordHash) {
      return NextResponse.json(
        { error: "לא נמצאה סיסמה — פנה למנהל הראשי" },
        { status: 500 }
      );
    }
    const ok = await verifyPassword(oldPassword, staff.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "הסיסמה הנוכחית שגויה" }, { status: 401 });
    }
    const newHash = await hashPassword(newPassword);
    await prisma.staff.update({
      where: { id: session.staffId },
      data: { passwordHash: newHash },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "מצב לא נתמך" }, { status: 400 });
}
