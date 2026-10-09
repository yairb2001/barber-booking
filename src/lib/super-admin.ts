import type { NextRequest } from "next/server";
import { getRequestSession } from "@/lib/session";
import { sendMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { verifySession } from "@/lib/auth";
import { recordCrmNotification, type NotifyMeta } from "@/lib/crm/notify";

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

/** The platform owner, also while impersonating a tenant (the stashed
 *  super_origin session). Gates platform-only tools inside a tenant's screens,
 *  e.g. editing an agent's raw prompt. */
export async function isPlatformStaff(req: NextRequest): Promise<boolean> {
  if (isSuperAdmin(req)) return true;
  const origin = await verifySession(req.cookies.get("super_origin")?.value);
  return !!origin && origin.businessId === SUPER_ADMIN_BUSINESS_ID;
}

/**
 * Fire-and-forget WhatsApp alert to the platform owner. Sent from the super
 * business's own (connected) WhatsApp line. Never throws — alerts must not break
 * the flow that triggered them (a signup or a lead capture).
 */
export async function notifyPlatformOwner(body: string, meta?: NotifyMeta): Promise<void> {
  // Also into the CRM's notifications feed (kind + link when the caller knows them).
  await recordCrmNotification(body, meta);
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
