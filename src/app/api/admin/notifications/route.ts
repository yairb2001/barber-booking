import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, scopedStaffId } from "@/lib/session";

export const dynamic = "force-dynamic";

// How far back the notification feed looks.
const LOOKBACK_DAYS = 14;
const MAX_EVENTS = 40;

const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const HE_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

// Friendly Hebrew label for an appointment date (UTC-midnight DateTime).
function apptDateLabel(date: Date): string {
  const todayUtc = new Date();
  const t0 = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate()));
  const d0 = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const diffDays = Math.round((d0.getTime() - t0.getTime()) / 86400000);
  const dayNum = date.getUTCDate();
  const month = HE_MONTHS[date.getUTCMonth()];
  if (diffDays === 0) return "היום";
  if (diffDays === 1) return "מחר";
  if (diffDays === -1) return "אתמול";
  return `יום ${HE_WEEKDAYS[d0.getUTCDay()]}, ${dayNum} ב${month}`;
}

// Read notificationsSeenAt (ms) from a settings JSON string.
function readSeenAt(settings: string | null): number {
  if (!settings) return 0;
  try {
    const cfg = JSON.parse(settings) as Record<string, unknown>;
    const v = cfg.notificationsSeenAt;
    if (typeof v === "string") { const t = Date.parse(v); return isNaN(t) ? 0 : t; }
    if (typeof v === "number") return v;
  } catch { /* malformed — treat as never seen */ }
  return 0;
}

type FeedEvent = {
  id: string;
  type: "booking" | "cancellation";
  at: string;            // ISO timestamp the event happened
  customerName: string;
  staffName: string;
  serviceName: string;
  dateLabel: string;     // appointment date, friendly Hebrew
  startTime: string;
  unread: boolean;
};

// GET /api/admin/notifications
// Returns recent booking/cancellation events scoped to the caller
// (barber → own appointments, owner → all) plus an unread flag for the bell dot.
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const staffScope = scopedStaffId(req); // undefined = owner (all), string = barber
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000);

  const appts = await prisma.appointment.findMany({
    where: {
      businessId: session.businessId,
      ...(staffScope ? { staffId: staffScope } : {}),
      OR: [
        { createdAt: { gte: since } },
        { cancelledAt: { gte: since } },
      ],
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      status: true,
      walkIn: true,
      createdAt: true,
      cancelledAt: true,
      customer: { select: { name: true } },
      staff: { select: { name: true } },
      service: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Seen-state lives per-user: barber → their Staff.settings, owner → Business.settings.
  let seenAt = 0;
  if (staffScope) {
    const s = await prisma.staff.findUnique({ where: { id: staffScope }, select: { settings: true } });
    seenAt = readSeenAt(s?.settings ?? null);
  } else {
    const b = await prisma.business.findUnique({ where: { id: session.businessId }, select: { settings: true } });
    seenAt = readSeenAt(b?.settings ?? null);
  }

  const events: FeedEvent[] = [];
  for (const a of appts) {
    const base = {
      customerName: a.customer?.name ?? "לקוח",
      staffName: a.staff?.name ?? "",
      serviceName: a.service?.name ?? "",
      dateLabel: apptDateLabel(a.date),
      startTime: a.startTime,
    };
    // New booking — skip walk-ins (those are added in person by staff, not a notification).
    if (!a.walkIn && a.createdAt >= since) {
      events.push({
        id: `${a.id}:b`,
        type: "booking",
        at: a.createdAt.toISOString(),
        unread: a.createdAt.getTime() > seenAt,
        ...base,
      });
    }
    // Customer-initiated cancellation — staff should know.
    if (a.status === "cancelled_by_customer" && a.cancelledAt && a.cancelledAt >= since) {
      events.push({
        id: `${a.id}:c`,
        type: "cancellation",
        at: a.cancelledAt.toISOString(),
        unread: a.cancelledAt.getTime() > seenAt,
        ...base,
      });
    }
  }

  events.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  const trimmed = events.slice(0, MAX_EVENTS);

  return NextResponse.json({
    isOwner: session.isOwner,
    hasUnread: trimmed.some(e => e.unread),
    events: trimmed,
  });
}

// POST /api/admin/notifications  → mark all current notifications as seen.
export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const staffScope = scopedStaffId(req);
  const nowIso = new Date().toISOString();

  if (staffScope) {
    const s = await prisma.staff.findUnique({ where: { id: staffScope }, select: { settings: true } });
    const cfg = (() => { try { return s?.settings ? JSON.parse(s.settings) : {}; } catch { return {}; } })();
    await prisma.staff.update({
      where: { id: staffScope },
      data: { settings: JSON.stringify({ ...cfg, notificationsSeenAt: nowIso }) },
    });
  } else {
    const b = await prisma.business.findUnique({ where: { id: session.businessId }, select: { settings: true } });
    const cfg = (() => { try { return b?.settings ? JSON.parse(b.settings) : {}; } catch { return {}; } })();
    await prisma.business.update({
      where: { id: session.businessId },
      data: { settings: JSON.stringify({ ...cfg, notificationsSeenAt: nowIso }) },
    });
  }

  return NextResponse.json({ ok: true });
}
