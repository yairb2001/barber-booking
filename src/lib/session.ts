import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

export type EffectivePermissions = {
  isOwner: boolean;
  staffId?: string;
  /** Barber can see ALL barbers' calendars (else: only their own column). */
  canViewAllCalendars: boolean;
  /** Barber can access the chats inbox and see ALL conversations (else: no chat access). */
  canViewAllChats: boolean;
};

/**
 * Resolves the EFFECTIVE permissions for the current caller.
 *
 * Owner → everything true.
 * Barber → granted when EITHER the per-staff flag (set per barber in
 *          /admin/staff/[id]) OR the business-wide flag (set in business
 *          settings) is on. This lets the owner grant access globally to all
 *          barbers, or selectively to an individual barber.
 *
 * Hits the DB (Staff + Business), so call once per request and reuse.
 */
export async function getEffectivePermissions(req: NextRequest): Promise<EffectivePermissions> {
  const session = getRequestSession(req);
  if (!session) {
    return { isOwner: false, canViewAllCalendars: false, canViewAllChats: false };
  }
  if (session.isOwner) {
    return { isOwner: true, staffId: session.staffId, canViewAllCalendars: true, canViewAllChats: true };
  }

  const [staff, business] = await Promise.all([
    session.staffId
      ? prisma.staff.findUnique({
          where: { id: session.staffId },
          select: { canViewAllCalendars: true, canViewAllChats: true },
        })
      : Promise.resolve(null),
    prisma.business.findFirst({
      where: { id: session.businessId },
      select: { settings: true },
    }),
  ]);

  let bs: Record<string, unknown> = {};
  try { bs = JSON.parse(business?.settings || "{}"); } catch { /* ignore malformed settings */ }

  return {
    isOwner: false,
    staffId: session.staffId,
    canViewAllCalendars: !!(staff?.canViewAllCalendars || bs.barbersCanViewOthersCalendar),
    canViewAllChats: !!(staff?.canViewAllChats || bs.barbersCanAccessChats),
  };
}
