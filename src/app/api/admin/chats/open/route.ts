import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBusiness } from "@/lib/session";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

// POST /api/admin/chats/open  { phone } → { id }
// Find-or-create the conversation for this phone so the inbox can open a
// thread even before a single message was exchanged (deep-link from the
// appointment card / customer card). Tenant-scoped; no message is sent.
export async function POST(req: NextRequest) {
  const business = await getSessionBusiness(req, { id: true });
  if (!business) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const normalized = normalizeIsraeliPhone(String(body?.phone || ""));
  if (!normalized) return NextResponse.json({ error: "phone required" }, { status: 400 });

  let conv = await prisma.conversation.findFirst({
    where: { businessId: business.id, phone: normalized },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: { businessId: business.id, phone: normalized, agentType: "customer", status: "active" },
      select: { id: true },
    });
  }
  return NextResponse.json({ id: conv.id });
}
