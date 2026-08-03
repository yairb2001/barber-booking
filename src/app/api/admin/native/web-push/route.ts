import { NextRequest, NextResponse } from "next/server";
import { getRequestSession } from "@/lib/session";
import {
  saveWebPushSub, removeWebPushSub,
  saveStaffWebPushSub, removeStaffWebPushSub,
  VAPID_PUBLIC_KEY,
} from "@/lib/native/web-push";

export const dynamic = "force-dynamic";

// GET → the public VAPID key the browser needs to subscribe.
export async function GET() {
  return NextResponse.json({ publicKey: VAPID_PUBLIC_KEY });
}

// POST → save this browser's push subscription. Owner → Business.settings,
// barber → their own Staff.settings — each subscriber gets their own device
// list and their own on/off toggles.
export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.isOwner && !session.staffId) {
    return NextResponse.json({ error: "no staff on session" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };

  if (session.isOwner) {
    await saveWebPushSub(session.businessId, clean);
  } else {
    await saveStaffWebPushSub(session.staffId as string, clean);
  }
  return NextResponse.json({ ok: true });
}

// DELETE → drop a subscription (device turned notifications off).
export async function DELETE(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body?.endpoint) return NextResponse.json({ ok: true });

  if (session.isOwner) {
    await removeWebPushSub(session.businessId, body.endpoint);
  } else if (session.staffId) {
    await removeStaffWebPushSub(session.staffId, body.endpoint);
  }
  return NextResponse.json({ ok: true });
}
