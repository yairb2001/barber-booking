import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBusinessNow, addDaysISO } from "@/lib/utils";
import { sendWaitlistEntryNotification } from "@/lib/waitlist-notify";
import { computeDayAvailability } from "@/lib/agent/availability";

/**
 * Cron endpoint — runs daily (e.g. 05:00 UTC = 08:00 Israel).
 *
 * Scenario 3 from the waitlist spec: a day's appointments "open automatically"
 * the moment that date enters the booking horizon. Every day exactly one new
 * date crosses into the bookable window (today + horizonDays − 1). This cron
 * finds "waiting" waitlist entries sitting on that freshly-opened date and
 * notifies them once — automatically, with no manager prompt (there's no
 * manager action involved; it's the calendar advancing).
 *
 * Crossing into the horizon does NOT mean the date is actually bookable — the
 * staff member (or, for "any barber" entries, every barber) might have that
 * date off entirely (weekly day-off or a specific-date override). We confirm
 * real availability via computeDayAvailability (the same source of truth the
 * booking agent and /api/slots use) before sending; otherwise the customer
 * gets a "the day opened!" message for a day with nothing to book.
 *
 * Authorization: Vercel Cron adds `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { date: todayISO } = getBusinessNow();

  // Only businesses that actually have someone waiting on a future date.
  const businesses = await prisma.business.findMany({
    select: { id: true, name: true, slug: true, bookingHorizonDays: true, waitlistNotifyTemplate: true },
  });

  let notified = 0;
  const details: string[] = [];

  for (const biz of businesses) {
    const defaultHorizon = biz.bookingHorizonDays ?? 30;

    // Per-staff horizon overrides (settings JSON → bookingHorizonDays).
    const staff = await prisma.staff.findMany({
      where: { businessId: biz.id },
      select: { id: true, settings: true },
    });
    const horizonByStaff = new Map<string, number>();
    for (const s of staff) {
      let h = defaultHorizon;
      try {
        const parsed = s.settings ? JSON.parse(s.settings) : {};
        const v = Number(parsed.bookingHorizonDays);
        if (!isNaN(v) && v > 0) h = v;
      } catch { /* ignore bad JSON */ }
      horizonByStaff.set(s.id, h);
    }

    // All "waiting" entries from today onward for this business.
    const todayMidnight = new Date(todayISO + "T00:00:00.000Z");
    const entries = await prisma.waitlist.findMany({
      where: { businessId: biz.id, status: "waiting", date: { gte: todayMidnight } },
      include: {
        customer: { select: { name: true, phone: true } },
        service:  { select: { name: true } },
        staff:    { select: { name: true } },
      },
    });

    for (const entry of entries) {
      // Effective horizon: per-staff override if a specific barber was chosen,
      // otherwise the business default (any-barber registration).
      const horizon = entry.staffId
        ? (horizonByStaff.get(entry.staffId) ?? defaultHorizon)
        : defaultHorizon;

      // The single date that newly opens for booking *today*.
      const newlyOpenISO = addDaysISO(todayISO, horizon - 1);
      const entryISO = entry.date.toISOString().split("T")[0];
      if (entryISO !== newlyOpenISO) continue;

      // The date entering the horizon doesn't guarantee it's actually
      // bookable — skip silently (stay "waiting", try again on a future
      // trigger) if the relevant staff (or, for "any barber", every staff)
      // has that date off.
      const available = await computeDayAvailability(biz.id, entryISO, entry.staffId ?? undefined, entry.serviceId);
      if (available.length === 0) continue;

      void sendWaitlistEntryNotification(biz.name, {
        id: entry.id,
        businessId: entry.businessId,
        date: entry.date,
        preferredTimeOfDay: entry.preferredTimeOfDay,
        customer: entry.customer,
        service: entry.service,
        staff: entry.staff,
      }, "day_open", biz.slug, biz.waitlistNotifyTemplate);
      notified++;
      details.push(`${biz.name}: ${entry.customer.name} → ${entryISO}`);
    }
  }

  return NextResponse.json({ ok: true, notified, details });
}
