import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBusiness } from "@/lib/session";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

// POST /api/admin/chats/open  { phone } → { id: string | null }
// Look up (never create) the conversation for this phone, for the deep-link
// from the appointment card / customer card. Returns id: null when the
// customer never messaged — the caller shows an empty composer without
// writing anything to the database, so merely opening a customer's card
// never leaves a ghost empty conversation sitting in the inbox. A real
// conversation row is only created once a message is actually sent (see
// /api/admin/chats/send-quick). Tenant-scoped; no message is sent here.
export async function POST(req: NextRequest) {
  const business = await getSessionBusiness(req, { id: true });
  if (!business) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const normalized = normalizeIsraeliPhone(String(body?.phone || ""));
  if (!normalized) return NextResponse.json({ error: "phone required" }, { status: 400 });

  const conv = await prisma.conversation.findFirst({
    where: { businessId: business.id, phone: normalized },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return NextResponse.json({ id: conv?.id ?? null });
}
