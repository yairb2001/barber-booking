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
  const owner = await prisma.staff.findFirst({
    where: { businessId, role: "owner", isActive: true },
    select: { id: true },
  });
  if (!owner) return true;                  // can't resolve owner-barber → don't hide
  return owner.id === eventStaffId;
}

/** Parse a Business.settings JSON string into an object (never throws). */
export function parseSettingsObj(raw: string | null | undefined): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
