import { SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";

/** The 25.11.2026 additions to what the agent reads and handles (the named treatment's times in a men's shop, the asked
 *  part of the day, who is off when, two requests in one message). DOMINANT keeps its own until Yair says yes. */
export const widerContext = (businessId: string): boolean => businessId !== SUPER_ADMIN_BUSINESS_ID;
