import { SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";

/** What the agent reads and handles beyond DOMINANT's own flow: the 25.11.2026 additions and the 27.11.2026 trial fixes, which
 *  Yair approved for every business (27.11.2026). DOMINANT keeps its own until Yair says yes. */
export const widerContext = (businessId: string): boolean => businessId !== SUPER_ADMIN_BUSINESS_ID;

/** A fix on trial: only the test businesses (settings.vtest) run it until the whole re-test passes (27.11.2026). */
export const onTrial = (settings: string | null | undefined): boolean => { try { return JSON.parse(settings ?? "{}").vtest === true; } catch { return false; } };
