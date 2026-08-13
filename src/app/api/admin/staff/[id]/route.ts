import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner, requireStaffInBusiness } from "@/lib/session";
import { sanitizePhoneInput } from "@/lib/messaging/phone";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireStaffInBusiness(req, params.id);
  if (guard) return guard;
  const staff = await prisma.staff.findUnique({
    where: { id: params.id },
    include: { schedules: true },
  });
  if (!staff) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(staff);
}

// Merge `patch` into this staff row's CURRENT settings (a fresh read, done
// right here rather than trusting whatever snapshot the caller fetched
// earlier) and return the JSON string to write. Several independent toggles
// (notifications, booking-horizon overrides, ...) all share this one JSON
// blob with no coordination between their save calls — reading fresh at
// write-time shrinks the race window from "however long the tab's been
// open" to "a couple concurrent requests, milliseconds apart".
async function mergeStaffSettings(staffId: string, patch: Record<string, unknown>): Promise<string> {
  const row = await prisma.staff.findUnique({ where: { id: staffId }, select: { settings: true } });
  let current: Record<string, unknown> = {};
  try { current = row?.settings ? JSON.parse(row.settings) : {}; } catch { /* ignore */ }
  return JSON.stringify({ ...current, ...patch });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();

  // Barbers can update only their own record, and only limited fields
  if (!session.isOwner) {
    if (session.staffId !== params.id) {
      return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
    }
    // Only avatarUrl, tagline and settings are self-editable by barbers
    const data: Record<string, unknown> = {};
    if (body.avatarUrl !== undefined) data.avatarUrl = body.avatarUrl;
    if (body.tagline !== undefined) data.tagline = body.tagline ? String(body.tagline).trim() : null;
    if (body.settingsPatch !== undefined) {
      data.settings = await mergeStaffSettings(params.id, body.settingsPatch);
    } else if (body.settings !== undefined) {
      data.settings = body.settings === null ? null
        : typeof body.settings === "string" ? body.settings
        : JSON.stringify(body.settings);
    }
    const staff = await prisma.staff.update({ where: { id: params.id }, data });
    return NextResponse.json(staff);
  }

  // Owner — full update
  const guard = requireOwner(req);
  if (guard) return guard;
  const tenantGuard = await requireStaffInBusiness(req, params.id);
  if (tenantGuard) return tenantGuard;
  const settingsValue = body.settingsPatch !== undefined
    ? await mergeStaffSettings(params.id, body.settingsPatch)
    : body.settings !== undefined
      ? (body.settings === null ? null
        : typeof body.settings === "string" ? body.settings
        : JSON.stringify(body.settings))
      : undefined;
  const staff = await prisma.staff.update({
    where: { id: params.id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.tagline !== undefined && { tagline: body.tagline ? String(body.tagline).trim() : null }),
      ...(body.phone !== undefined && { phone: body.phone ? sanitizePhoneInput(body.phone) : null }),
      ...(body.avatarUrl !== undefined && { avatarUrl: body.avatarUrl }),
      ...(body.isAvailable !== undefined && { isAvailable: body.isAvailable }),
      ...(body.inQuickPool !== undefined && { inQuickPool: body.inQuickPool }),
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      ...(settingsValue !== undefined && { settings: settingsValue }),
      ...(body.canViewAllCalendars !== undefined && { canViewAllCalendars: !!body.canViewAllCalendars }),
      ...(body.canViewAllChats     !== undefined && { canViewAllChats:     !!body.canViewAllChats     }),
      ...(body.canUseOwnerAgent     !== undefined && { canUseOwnerAgent:    !!body.canUseOwnerAgent    }),
    },
  });
  return NextResponse.json(staff);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const tenantGuard = await requireStaffInBusiness(req, params.id);
  if (tenantGuard) return tenantGuard;
  const staffId = params.id;

  // Block if future confirmed appointments exist
  const futureAppts = await prisma.appointment.count({
    where: {
      staffId,
      date: { gte: new Date() },
      status: { in: ["confirmed", "pending"] },
    },
  });
  if (futureAppts > 0) {
    return NextResponse.json(
      { error: `לא ניתן למחוק — יש ${futureAppts} תורים עתידיים פעילים` },
      { status: 409 }
    );
  }

  // Soft-delete: hide from calendar + public booking, but keep ALL history
  // (appointments, schedules, services, portfolio) so stats aren't corrupted.
  await prisma.staff.update({
    where: { id: staffId },
    data: { isActive: false, isAvailable: false, inQuickPool: false },
  });

  return NextResponse.json({ ok: true });
}
