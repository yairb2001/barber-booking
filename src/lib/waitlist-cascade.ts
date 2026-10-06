// Waitlist "in turns" (owner's spec, 6.10.2026): when a slot frees up, the
// people waiting for that day are messaged ONE AT A TIME in sign-up order,
// N minutes apart (default 5), each with a link straight to that slot. While
// it's someone's turn the slot is held for them (hidden from everyone else);
// the next person is only messaged if the slot is still free when their turn
// comes. Off by default; Business.settings.waitlistCascade turns it on.
import { prisma } from "@/lib/prisma";
import { computeDayAvailability } from "@/lib/agent/availability";
import { holdSlot, releaseHolds, holderKeyForWeb } from "@/lib/slot-holds";

export type CascadeSettings = { enabled: boolean; minutes: number };

export function cascadeSettings(settingsJson: string | null | undefined): CascadeSettings {
  try {
    const s = JSON.parse(settingsJson || "{}");
    const m = Number(s.waitlistCascadeMinutes);
    return { enabled: s.waitlistCascade === true, minutes: Number.isFinite(m) && m >= 1 && m <= 60 ? Math.round(m) : 5 };
  } catch { return { enabled: false, minutes: 5 }; }
}

/** One person's turn. Stored as MessageLog.meta = { wl: CascadeStep } for the queued ones. */
export type CascadeStep = {
  cascadeId: string;
  entryId: string;
  businessId: string;
  staffId: string;
  date: string;      // YYYY-MM-DD
  startTime: string; // HH:MM
  serviceId: string;
  customerId: string | null;
  holdToken: string;
  minutes: number;
};

export function newHoldToken(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^\w-]/g, "");
}

/** Straight to the confirm screen of that slot; `hold` lets the screen own the hold made for him. */
export function cascadeSlotLink(slug: string | null | undefined, step: Pick<CascadeStep, "staffId" | "serviceId" | "date" | "startTime" | "holdToken">): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
  const q = new URLSearchParams({ staffId: step.staffId, serviceId: step.serviceId, date: step.date, time: step.startTime, hold: step.holdToken, from: "waitlist" });
  return `${base}${slug ? `/${slug}` : ""}/book/confirm?${q.toString()}`;
}

/**
 * Start someone's turn: drop the previous person's hold, make sure the slot is
 * still bookable (free, in the future, inside working hours) and hold it for
 * this person. false → the slot is gone; don't message him (nor anyone after).
 */
export async function startCascadeTurn(step: CascadeStep): Promise<boolean> {
  await releaseHolds({ proposalId: `wl:${step.cascadeId}` });
  const avail = await computeDayAvailability(step.businessId, step.date, step.staffId, step.serviceId).catch(() => []);
  if (!(avail.find(a => a.staffId === step.staffId)?.slots ?? []).includes(step.startTime)) return false;
  const [ss, svc] = await Promise.all([
    prisma.staffService.findFirst({ where: { staffId: step.staffId, serviceId: step.serviceId }, select: { customDuration: true } }),
    prisma.service.findUnique({ where: { id: step.serviceId }, select: { durationMinutes: true } }),
  ]);
  const dur = ss?.customDuration ?? svc?.durationMinutes ?? 30;
  const [h, m] = step.startTime.split(":").map(Number);
  const end = h * 60 + m + dur;
  await holdSlot({
    businessId: step.businessId, staffId: step.staffId, dateISO: step.date, startTime: step.startTime,
    endTime: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
    holderKey: holderKeyForWeb(step.holdToken), customerId: step.customerId, proposalId: `wl:${step.cascadeId}`, minutes: step.minutes,
  });
  return true;
}

export function parseCascadeMeta(meta: string | null | undefined): CascadeStep | null {
  if (!meta) return null;
  try { const m = JSON.parse(meta); return m?.wl?.cascadeId ? m.wl as CascadeStep : null; } catch { return null; }
}
