import { NextRequest, NextResponse } from "next/server";

export type RequestSession = {
  businessId: string;
  role: "owner" | "barber";
  staffId?: string;
  isOwner: boolean;
};

/** Read session injected by middleware headers. */
export function getRequestSession(req: NextRequest): RequestSession | null {
  const businessId = req.headers.get("x-session-business-id");
  const role = req.headers.get("x-session-role") as "owner" | "barber" | null;
  if (!businessId || !role) return null;
  const staffId = req.headers.get("x-session-staff-id") || undefined;
  return { businessId, role, staffId, isOwner: role === "owner" };
}

/**
 * Guard for owner-only endpoints.
 * Returns a 403 NextResponse if the caller is a barber/unauth, or null if owner.
 *
 * Usage at the top of an owner-only route:
 *   const guard = requireOwner(req);
 *   if (guard) return guard;
 */
export function requireOwner(req: NextRequest): NextResponse | null {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!session.isOwner) {
    return NextResponse.json(
      { error: "פעולה זו זמינה למנהל ראשי בלבד" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Returns the staffId to scope queries to.
 * - Owner → undefined (sees everything)
 * - Barber → their own staffId (sees only their own data)
 * - Unauthenticated → null (caller should bail with 401)
 */
export function scopedStaffId(req: NextRequest): string | undefined | null {
  const session = getRequestSession(req);
  if (!session) return null;
  if (session.isOwner) return undefined;
  return session.staffId;
}

/**
 * Checks that a barber is acting on their own resource.
 * Returns 403 if a barber tries to act on a resource that's not theirs.
 * Owner is always allowed.
 */
export function requireOwnStaffOrOwner(
  req: NextRequest,
  resourceStaffId: string
): NextResponse | null {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.isOwner) return null;
  if (session.staffId !== resourceStaffId) {
    return NextResponse.json({ error: "אין הרשאה למשאב זה" }, { status: 403 });
  }
  return null;
}
