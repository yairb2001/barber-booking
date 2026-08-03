import { prisma } from "@/lib/prisma";

/**
 * Owner notification SCOPE — orthogonal to the per-type toggles
 * (notifyOnAppointments / notifyOnCancellation / …). Stored in
 * `Business.settings.ownerNotifyScope`:
 *
 *   "all"  (default) — notify the owner about EVERY barber's events.
 *   "mine"           — only events on the owner's OWN calendar, PLUS
 *                      business-level events not tied to a specific barber
 *                      (new WhatsApp messages, escalations, change-request
 *                      outcomes, waitlist for "any barber").
 *   "off"            — no owner notifications at all.
 *
 * `eventStaffId` = the barber the event concerns; null/undefined = business-level.
 * Fail OPEN (return true) on any ambiguity so a misconfig never silences alerts.
 */
export async function ownerScopeAllows(
  businessId: string,
  settings: Record<string, unknown>,
  eventStaffId: string | null | undefined,
): Promise<boolean> {
  const scope = typeof settings.ownerNotifyScope === "string" ? settings.ownerNotifyScope : "all";
  if (scope === "off") return false;
  if (scope !== "mine") return true;        // "all" (or unknown) → allow everything
  if (!eventStaffId) return true;           // business-level / management event
  const ownerId = await resolveOwnerStaffId(businessId);
  if (!ownerId) return true;                // can't resolve owner-barber → don't hide
  return ownerId === eventStaffId;
}

function digits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}
function phoneMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = digits(a), db = digits(b);
  if (!da || !db) return false;
  return da === db || da.endsWith(db) || db.endsWith(da);
}

/**
 * Which Staff row is "the owner's own calendar" (for scope "mine").
 *
 * Nothing in the app ever sets Staff.role = "owner" — every business's staff
 * rows default to "barber" and stay that way even when one of them IS the
 * owner cutting their own customers' hair. Prefer role="owner" in case that
 * ever changes, but resolve by PHONE MATCH against the business's own login
 * phone (Business.phone / settings.ownerLoginPhone) as the real mechanism —
 * the same signal /api/admin/auth/login already uses to resolve "which
 * business does this phone belong to".
 */
async function resolveOwnerStaffId(businessId: string): Promise<string | null> {
  const byRole = await prisma.staff.findFirst({
    where: { businessId, role: "owner", isActive: true },
    select: { id: true },
  });
  if (byRole) return byRole.id;

  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { phone: true, settings: true } });
  if (!biz) return null;
  let ownerLoginPhone: string | null = null;
  try {
    const s = biz.settings ? JSON.parse(biz.settings) : {};
    if (typeof s.ownerLoginPhone === "string") ownerLoginPhone = s.ownerLoginPhone;
  } catch { /* ignore */ }
  const ownerPhones = [ownerLoginPhone, biz.phone].filter((p): p is string => !!p);
  if (!ownerPhones.length) return null;

  const staffList = await prisma.staff.findMany({
    where: { businessId, isActive: true },
    select: { id: true, phone: true },
  });
  const match = staffList.find(st => ownerPhones.some(p => phoneMatches(p, st.phone)));
  return match?.id ?? null;
}

/** Parse a Business.settings JSON string into an object (never throws). */
export function parseSettingsObj(raw: string | null | undefined): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
