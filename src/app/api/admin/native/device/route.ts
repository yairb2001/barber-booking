import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

/**
 * POST /api/admin/native/device
 * Body: { token: string, platform: "ios" | "android" }
 *
 * Stores the push token on the staff record (in `settings` JSON) so we can
 * later send urgent notifications to specific staff members.
 */
export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { token, platform } = await req.json();
  if (!token || !platform) return NextResponse.json({ error: "token + platform required" }, { status: 400 });

  // Owner-only logins (without staffId) — store on the business settings.
  if (!session.staffId) {
    const biz = await prisma.business.findFirst();
    if (!biz) return NextResponse.json({ error: "no business" }, { status: 400 });
    const existing = (() => {
      try { return biz.settings ? JSON.parse(biz.settings) : {}; } catch { return {}; }
    })();
    const tokens: Array<{ token: string; platform: string; registeredAt: string }> = Array.isArray(existing.ownerPushTokens) ? existing.ownerPushTokens : [];
    const filteredOwner = tokens.filter(t => t?.token !== token);
    const updated = [...filteredOwner, { token, platform, registeredAt: new Date().toISOString() }];
    await prisma.business.update({
      where: { id: biz.id },
      data: { settings: JSON.stringify({ ...existing, ownerPushTokens: updated }) },
    });
    return NextResponse.json({ ok: true, scope: "owner" });
  }

  // Barber — store on the staff record
  const staff = await prisma.staff.findUnique({ where: { id: session.staffId } });
  if (!staff) return NextResponse.json({ error: "staff not found" }, { status: 404 });

  const existing = (() => {
    try { return staff.settings ? JSON.parse(staff.settings) : {}; } catch { return {}; }
  })();
  const tokens = Array.isArray(existing.pushTokens) ? existing.pushTokens : [];
  // De-dupe by token value
  const filtered = tokens.filter((t: { token?: string }) => t?.token !== token);
  const updated = [...filtered, { token, platform, registeredAt: new Date().toISOString() }];

  await prisma.staff.update({
    where: { id: session.staffId },
    data: { settings: JSON.stringify({ ...existing, pushTokens: updated }) },
  });

  return NextResponse.json({ ok: true, scope: "barber" });
}
