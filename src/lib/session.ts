import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

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
 * Resolve the Business for the CURRENT admin session (scoped to session.businessId).
 *
 * Use this in admin routes INSTEAD of `prisma.business.findFirst()`. With more
 * than one tenant, findFirst() reads/writes the wrong business — this guarantees
 * every admin query is bound to the logged-in owner/barber's own business.
 *
 * Returns null if there is no session (caller should bail with 401).
 */
export async function getSessionBusiness<T extends Prisma.BusinessSelect>(
  req: NextRequest,
  select?: T,
): Promise<Prisma.BusinessGetPayload<{ select: T }> | null> {
  const session = getRequestSession(req);
  if (!session) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args: any = { where: { id: session.businessId } };
  if (select) args.select = select;
  return prisma.business.findUnique(args) as never;
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
 * Barber → controlled SOLELY by the per-staff flags (set per barber in
 *          /admin/staff/[id] → "הרשאות"). This makes the per-barber toggle
 *          authoritative: turning it OFF actually denies access.
 *
 *          The business-wide switches in /admin/settings are a convenience
 *          that BULK-WRITE these per-staff flags when toggled (see the settings
 *          PATCH route) — they are NOT OR-ed in at runtime, otherwise a global
 *          "on" could never be overridden/denied for an individual barber.
 *
 * Hits the DB (Staff), so call once per request and reuse.
 */
export async function getEffectivePermissions(req: NextRequest): Promise<EffectivePermissions> {
  const session = getRequestSession(req);
  if (!session) {
    return { isOwner: false, canViewAllCalendars: false, canViewAllChats: false };
  }
  if (session.isOwner) {
    return { isOwner: true, staffId: session.staffId, canViewAllCalendars: true, canViewAllChats: true };
  }

  const staff = session.staffId
    ? await prisma.staff.findUnique({
        where: { id: session.staffId },
        select: { canViewAllCalendars: true, canViewAllChats: true },
      })
    : null;

  return {
    isOwner: false,
    staffId: session.staffId,
    canViewAllCalendars: !!staff?.canViewAllCalendars,
    canViewAllChats: !!staff?.canViewAllChats,
  };
}
