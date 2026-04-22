import { NextRequest } from "next/server";

export type RequestSession = {
  businessId: string;
  role: "owner" | "barber";
  staffId?: string;
  isOwner: boolean;
};

/** Read session injected by middleware headers */
export function getRequestSession(req: NextRequest): RequestSession | null {
  const businessId = req.headers.get("x-session-business-id");
  const role = req.headers.get("x-session-role") as "owner" | "barber" | null;
  if (!businessId || !role) return null;
  const staffId = req.headers.get("x-session-staff-id") || undefined;
  return { businessId, role, staffId, isOwner: role === "owner" };
}
