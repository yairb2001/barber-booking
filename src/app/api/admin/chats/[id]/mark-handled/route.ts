import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getEffectivePermissions, getSessionBusiness } from "@/lib/session";

// POST /api/admin/chats/[id]/mark-handled
// Body: { handled?: boolean, snoozeHours?: number }  (defaults to handled=true)
// snoozeHours → "remind me later": the alert disappears and comes back red at
// that time (snoozedUntil), without marking handled.
//
// Marks a conversation as handled without replying — it drops the red "needs
// handling" alert while the customer hasn't written again. A newer customer
// message (createdAt > handledAt) re-flags it automatically (see chats list API).
// handled=false clears the marker.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await getSessionBusiness(req, { id: true, chatsEnabled: true });
  if (!business?.chatsEnabled) return NextResponse.json({ error: "feature_disabled" }, { status: 403 });

  // Body is optional — default to marking handled.
  let handled = true;
  let snoozeHours = 0;
  try {
    const body = await req.json();
    if (body && typeof body.handled === "boolean") handled = body.handled;
    if (body && typeof body.snoozeHours === "number" && body.snoozeHours > 0) snoozeHours = Math.min(body.snoozeHours, 24 * 7);
  } catch {
    // no body → keep default true
  }

  // Permission enforcement: barber needs "view all chats" to manage the inbox.
  const perms = await getEffectivePermissions(req);
  if (!perms.isOwner && !perms.canViewAllChats) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const conv = await prisma.conversation.findFirst({
    where: { id: params.id, businessId: business.id },
  });
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (snoozeHours > 0) {
    const until = new Date(Date.now() + snoozeHours * 3_600_000);
    await prisma.conversation.update({ where: { id: conv.id }, data: { snoozedUntil: until, lastReadAt: new Date() } });
    return NextResponse.json({ ok: true, snoozedUntil: until });
  }

  const updated = await prisma.conversation.update({
    where: { id: conv.id },
    // Marking handled also counts as reading it (clears the unread badge).
    data: handled
      ? { handledAt: new Date(), lastReadAt: new Date(), snoozedUntil: null }
      : { handledAt: null, snoozedUntil: null },
  });

  return NextResponse.json({ ok: true, handledAt: updated.handledAt });
}
