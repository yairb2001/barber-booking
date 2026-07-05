import type { NextRequest } from "next/server";
import { getRequestSession } from "@/lib/session";
import { sendMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

/**
 * The platform owner's own business id. The super-admin dashboard (/admin/super)
 * is gated to the OWNER of this single business — i.e. Yair, logged into the
 * DOMINANT tenant. Overridable via env for other deployments.
 */
export const SUPER_ADMIN_BUSINESS_ID =
  process.env.SUPER_ADMIN_BUSINESS_ID || "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2";

/** Phone that receives platform alerts (new lead / new signup). */
export const SUPER_ADMIN_PHONE = process.env.SUPER_ADMIN_PHONE || "0585859990";

/** True when the caller is the platform owner (owner role of the super business). */
export function isSuperAdmin(req: NextRequest): boolean {
  const session = getRequestSession(req);
  return !!session && session.isOwner && session.businessId === SUPER_ADMIN_BUSINESS_ID;
}

/**
 * Fire-and-forget WhatsApp alert to the platform owner. Sent from the super
 * business's own (connected) WhatsApp line. Never throws — alerts must not break
 * the flow that triggered them (a signup or a lead capture).
 */
export async function notifyPlatformOwner(body: string): Promise<void> {
  try {
    await sendMessage({
      businessId: SUPER_ADMIN_BUSINESS_ID,
      customerPhone: normalizeIsraeliPhone(SUPER_ADMIN_PHONE),
      kind: "manual",
      body,
    });
  } catch (e) {
    console.error("[notifyPlatformOwner]", e);
  }
}
