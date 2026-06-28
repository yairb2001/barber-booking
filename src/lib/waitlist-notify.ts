import { prisma } from "@/lib/prisma";
import { enqueueMessage, sendMessage, applyTemplate, firstName, DEFAULT_WAITLIST_NOTIFY_TEMPLATE } from "@/lib/messaging";

// A waitlisted customer stays "waiting" after we notify them of a freed slot —
// the slot might not have suited them and they may want a LATER one. To avoid
// spamming them when several appointments are cancelled in quick succession, we
// don't re-notify the same entry within this window.
const RENOTIFY_THROTTLE_MS = 20 * 60 * 1000; // 20 minutes

// ── Time preference helpers ───────────────────────────────────────────────────

const TIME_PREF_RANGES: Record<string, [number, number]> = {
  morning:   [8, 12],   // 08:00–12:00
  afternoon: [12, 16],  // 12:00–16:00
  evening:   [16, 21],  // 16:00–21:00
  any:       [0, 24],
};

const TIME_PREF_LABELS: Record<string, string> = {
  morning:   "בבוקר",
  afternoon: "בצהריים",
  evening:   "בערב",
  any:       "",
};

/**
 * Returns true when the appointment startTime ("HH:MM") falls inside the
 * customer's preferred time window.
 */
export function matchesTimePreference(startTime: string, pref: string): boolean {
  const hour = parseInt(startTime.split(":")[0], 10);
  const [start, end] = TIME_PREF_RANGES[pref] ?? TIME_PREF_RANGES.any;
  return hour >= start && hour < end;
}

// ── Notification triggers ─────────────────────────────────────────────────────

/**
 * Called when an appointment is cancelled.
 * Notifies waitlist members whose time preference matches the cancelled slot.
 */
export async function notifyWaitlistForCancellation(opts: {
  businessId: string;
  staffId: string;
  date: Date;
  startTime: string; // "HH:MM" of the cancelled appointment
}) {
  await triggerWaitlist({
    ...opts,
    triggerType: "cancellation",
  });
}

/**
 * Called when a previously-closed day is reopened by the admin.
 * Notifies ALL waitlist members for that day (regardless of time preference).
 */
export async function notifyWaitlistForDayOpen(opts: {
  businessId: string;
  staffId: string;
  date: Date;
}) {
  await triggerWaitlist({
    ...opts,
    triggerType: "day_open",
  });
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function triggerWaitlist(opts: {
  businessId: string;
  staffId: string;
  date: Date;
  triggerType: "cancellation" | "day_open";
  startTime?: string;
}) {
  const { businessId, staffId, date, triggerType, startTime } = opts;

  // NOTE: waitlist notifications are NOT gated behind the "reminders" feature.
  // A freed-up slot is time-sensitive and a core part of the waitlist promise.
  // sendMessage() already no-ops gracefully when no provider is configured.
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) return;

  // Match the whole day as a RANGE, not an exact timestamp. Waitlist rows are
  // stored at UTC midnight, but an appointment's `date` can carry a time-of-day
  // (legacy rows) or drift by timezone — an exact-equality match would silently
  // miss the waiting customers and no one would be notified.
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // Find all "waiting" entries for this date that match either this specific
  // staff member OR an "any barber" registration (staffId === null). We also
  // skip anyone we already pinged within the throttle window, so a burst of
  // cancellations doesn't fire several messages at the same person — they stay
  // "waiting" and will be eligible again once the window passes.
  const throttleSince = new Date(Date.now() - RENOTIFY_THROTTLE_MS);
  const entries = await prisma.waitlist.findMany({
    where: {
      businessId,
      date: { gte: dayStart, lt: dayEnd },
      status: "waiting",
      AND: [
        { OR: [{ staffId }, { staffId: null }] },
        { OR: [{ notifiedAt: null }, { notifiedAt: { lt: throttleSince } }] },
      ],
    },
    include: {
      customer: true,
      service: true,
      staff: true,
    },
  });

  if (entries.length === 0) return;

  // A cancellation frees ONE slot and is time-sensitive, so we SEND those
  // immediately (and await them) rather than dropping them into the drip-queue
  // — the queue is drained by a separate every-minute cron, so a queued
  // freed-slot message would be delayed (or never sent if that cron is idle).
  // Day-reopen can match many people at once, so it stays on the safe queue.
  const immediate = triggerType === "cancellation";
  const tasks: Promise<unknown>[] = [];

  for (const entry of entries) {
    const pref = entry.preferredTimeOfDay || "any";

    // For cancellations: only notify if the cancelled slot matches their preference
    if (triggerType === "cancellation" && startTime) {
      if (!matchesTimePreference(startTime, pref)) continue;
    }

    tasks.push(
      sendWaitlistEntryNotification(
        business.name,
        entry,
        triggerType,
        business.slug,
        business.waitlistNotifyTemplate,
        { freedTime: triggerType === "cancellation" ? startTime : undefined, immediate },
      ),
    );
  }

  // Await so immediate sends actually complete before the (serverless) caller
  // is frozen. Enqueue-only sends resolve instantly, so this is cheap.
  await Promise.allSettled(tasks);
}

/** A waitlist row joined with the relations the message template needs. */
export type WaitlistEntryForNotify = {
  id: string;
  businessId: string;
  date: Date;
  preferredTimeOfDay: string | null;
  customer: { name: string; phone: string };
  service: { name: string };
  staff: { name: string } | null;
};

/**
 * Sends/enqueues ONE waitlist member a "slot freed up" message and stamps
 * notifiedAt. The entry STAYS "waiting" — the slot may not have suited them, so
 * they remain on the list and eligible for the next opening (throttled by
 * RENOTIFY_THROTTLE_MS so a burst of cancellations doesn't spam them).
 * BAN-SAFETY for bulk (day_open) sends: we don't send immediately — a reopened
 * day can match many waiting customers at once, which would blast the WhatsApp
 * number. Instead we enqueue with scheduledFor=now (high priority over staggered
 * broadcasts) and let the drip-queue cron (`/api/cron/drip-queue`) send ~1/min.
 * Fire-and-forget (does not block the caller). Reused by both the live triggers
 * above and the daily booking-horizon cron.
 */
export function sendWaitlistEntryNotification(
  businessName: string,
  entry: WaitlistEntryForNotify,
  triggerType: "cancellation" | "day_open",
  slug?: string | null,
  customTemplate?: string | null,
  opts?: {
    /** Exact "HH:MM" of the freed slot (cancellations) → shown in the message. */
    freedTime?: string;
    /** true → send right now; false/undefined → enqueue for the drip-queue. */
    immediate?: boolean;
  },
) {
  const { freedTime, immediate } = opts ?? {};
  const pref = entry.preferredTimeOfDay || "any";
  const prefLabel = TIME_PREF_LABELS[pref] ?? "";
  const staffName = entry.staff?.name ?? "";
  const dateLabel = entry.date.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Direct booking link for this business so the customer can grab the slot in
  // one tap (the message previously said "hurry to book" with no link).
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
  const bookingLink = `${baseUrl}${slug ? `/${slug}` : ""}/book`;

  // The opening phrase. For a cancellation we now know the EXACT freed time, so
  // say it ("תור פנוי בשעה 14:30") instead of the vague window ("תור פנוי בבוקר").
  // Day-reopen has no single time, so it keeps the window label.
  const timeLabel = freedTime ? `בשעה ${freedTime}` : prefLabel;
  const slotLabel = `${triggerType === "day_open" ? "יום נפתח" : "תור פנוי"}${timeLabel ? ` ${timeLabel}` : ""}`;

  // Render the owner's editable template (or the built-in default).
  let body = applyTemplate(customTemplate || DEFAULT_WAITLIST_NOTIFY_TEMPLATE, {
    name:         firstName(entry.customer.name),
    business:     businessName,
    slot:         slotLabel,
    time:         freedTime ?? "",
    date:         dateLabel,
    staff_line:   staffName ? `💈 אצל ${staffName}\n` : "",
    service:      entry.service.name,
    booking_link: bookingLink,
  });

  // Always guarantee a booking link. If the owner edited the template and
  // removed the link, append it so the customer can still tap through and grab
  // the slot — a waitlist message without a booking link is useless.
  if (bookingLink && !body.includes(bookingLink)) {
    body = `${body.trimEnd()}\n\n👇 קביעת תור:\n${bookingLink}`;
  }

  // Stamp notifiedAt (used to throttle repeat pings) but KEEP the entry
  // "waiting": the freed slot may not have suited them, so they stay on the
  // waitlist and remain eligible for the next slot that opens up.
  const markNotified = () =>
    prisma.waitlist.update({
      where: { id: entry.id },
      data: { notifiedAt: new Date() },
    }).catch(console.error);

  if (immediate) {
    // Time-sensitive freed slot → send now (awaited by the caller).
    return sendMessage({
      businessId: entry.businessId,
      customerPhone: entry.customer.phone,
      kind: "waitlist_notify",
      body,
    })
      .then(markNotified)
      .catch(console.error);
  }

  return enqueueMessage({
    businessId: entry.businessId,
    customerPhone: entry.customer.phone,
    kind: "waitlist_notify",
    body,
    scheduledFor: new Date(), // due now → drip cron sends it ahead of staggered broadcasts
  })
    .then(markNotified)
    .catch(console.error);
}
