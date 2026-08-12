import { prisma } from "@/lib/prisma";

/**
 * Business-wide barber permission switches are a CONVENIENCE that bulk-writes
 * the per-barber flags. The per-staff columns (Staff.canViewAllCalendars /
 * canViewAllChats) are the authoritative runtime control — see
 * getEffectivePermissions in src/lib/session.ts. Writing only the business
 * `settings` JSON changes nothing about what a barber can actually do.
 *
 * Every route that lets the owner flip a business-wide switch must call this,
 * or the toggle reports "saved" and silently does nothing.
 */
const BULK_KEYS = {
  barbersCanViewOthersCalendar: "canViewAllCalendars",
  barbersCanAccessChats: "canViewAllChats",
} as const;

/**
 * Applies any business-wide permission switch present in `patch` to every
 * barber in the business — but only where the value actually changed, so a
 * save that merely touches an unrelated setting never wipes per-barber
 * overrides the owner set from /admin/staff/[id].
 *
 * Returns the keys that were propagated (for logging/debugging).
 */
export async function propagateTeamPermissions(
  businessId: string,
  patch: Record<string, unknown> | undefined,
  existing: Record<string, unknown>,
): Promise<string[]> {
  if (!patch) return [];
  const applied: string[] = [];

  for (const [settingsKey, staffColumn] of Object.entries(BULK_KEYS)) {
    if (!(settingsKey in patch)) continue;
    const next = !!patch[settingsKey];
    if (next === !!existing[settingsKey]) continue; // unchanged — leave overrides alone
    await prisma.staff.updateMany({
      where: { businessId, role: "barber" },
      data: { [staffColumn]: next },
    });
    applied.push(settingsKey);
  }

  return applied;
}
