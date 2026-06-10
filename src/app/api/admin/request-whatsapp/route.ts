import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { sendMessage } from "@/lib/messaging";

/**
 * POST /api/admin/request-whatsapp — owner asks to connect WhatsApp (premium).
 *
 * Flips `Business.whatsappStatus` to "requested" and pings the platform admin
 * (Yair) so he can provision a GreenAPI instance manually. The notification is
 * best-effort: it goes out through whichever business already has a configured
 * GreenAPI provider (the platform business), addressed to PLATFORM_ADMIN_PHONE.
 * If no provider is configured the flag is still saved (a future super-admin
 * screen will surface pending requests), and the request succeeds regardless.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = requireOwner(req);
  if (guard) return guard;

  const business = await getSessionBusiness(req, {
    id: true,
    name: true,
    slug: true,
    phone: true,
    whatsappStatus: true,
  });
  if (!business) {
    return NextResponse.json({ error: "No business" }, { status: 400 });
  }

  // Already connected → nothing to request.
  if (business.whatsappStatus === "connected") {
    return NextResponse.json({ ok: true, whatsappStatus: "connected" });
  }

  await prisma.business.update({
    where: { id: business.id },
    data: { whatsappStatus: "requested" },
  });

  // Best-effort owner notification (does not affect the response).
  const adminPhone = process.env.PLATFORM_ADMIN_PHONE?.trim();
  if (adminPhone) {
    // Use a business that already has a working GreenAPI provider as the sender.
    const sender = await prisma.business.findFirst({
      where: { greenApiInstanceId: { not: null }, greenApiToken: { not: null } },
      select: { id: true },
    });
    if (sender) {
      const body =
        `📲 בקשת חיבור WhatsApp\n` +
        `עסק: ${business.name ?? "—"}\n` +
        `slug: ${business.slug ?? "—"}\n` +
        `טלפון: ${business.phone ?? "—"}`;
      await sendMessage({
        businessId: sender.id,
        customerPhone: adminPhone,
        kind: "manual",
        body,
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, whatsappStatus: "requested" });
}
