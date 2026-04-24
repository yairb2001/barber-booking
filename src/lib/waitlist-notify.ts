import { prisma } from "@/lib/prisma";
import { sendMessage, hasFeature } from "@/lib/messaging";

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

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business || !hasFeature(business.features, "reminders")) return;

  // Find all "waiting" entries for this staff + date (or any staff for this business + date)
  const entries = await prisma.waitlist.findMany({
    where: {
      businessId,
      staffId,
      date,
      status: "waiting",
    },
    include: {
      customer: true,
      service: true,
      staff: true,
    },
  });

  if (entries.length === 0) return;

  const dateLabel = date.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  for (const entry of entries) {
    const pref = entry.preferredTimeOfDay || "any";

    // For cancellations: only notify if the cancelled slot matches their preference
    if (triggerType === "cancellation" && startTime) {
      if (!matchesTimePreference(startTime, pref)) continue;
    }

    const prefLabel = TIME_PREF_LABELS[pref] ?? "";
    const staffName = entry.staff?.name ?? "";

    const lines = [
      `שלום ${entry.customer.name} 👋`,
      ``,
      `בשורות טובות! ${triggerType === "day_open" ? "יום נפתח" : "תור פנוי"} ${prefLabel}ב*${business.name}* ✂️`,
      `📅 ${dateLabel}`,
      staffName ? `💈 אצל ${staffName}` : null,
      `🔖 שירות: ${entry.service.name}`,
      ``,
      `מהרו לקבוע תור לפני שיתפס 🏃`,
    ].filter(Boolean).join("\n");

    // Fire-and-forget — don't block the caller
    sendMessage({
      businessId,
      customerPhone: entry.customer.phone,
      kind: "waitlist_notify",
      body: lines,
    })
      .then(() =>
        // Mark as notified so we don't spam them
        prisma.waitlist.update({
          where: { id: entry.id },
          data: { status: "notified" },
        }).catch(console.error)
      )
      .catch(console.error);
  }
}
