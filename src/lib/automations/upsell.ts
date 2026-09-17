/**
 * Post-booking upsell suggestion — "אגב, יש לנו גם פנוי לשיזוף ממש אחרי
 * התור שלך, מעניין אותך?" Generic, per-business (Business.settings.upsell),
 * not specific to any one shop/service.
 *
 * Every FACT here (is there really a free slot, which one, what price) is
 * computed in code, never left for the model to guess — this codebase has a
 * long history of the model hallucinating availability/prices when it isn't
 * handed a hard answer (see pending-reports.md). The model only phrases the
 * offer; findUpsellOffer() is the single source of truth for whether one
 * exists at all.
 */
import { prisma } from "@/lib/prisma";
import { computeDayAvailability, resolveStaffService } from "@/lib/agent/availability";
import { timeToMinutes } from "@/lib/utils";

export type UpsellConfig = { enabled: boolean; serviceId: string | null; windowMinutes: number };

const DEFAULT_WINDOW_MINUTES = 60;

export function getUpsellConfig(settingsRaw: string | Record<string, unknown> | null | undefined): UpsellConfig {
  let s: Record<string, unknown> = {};
  try {
    if (typeof settingsRaw === "string") s = settingsRaw ? JSON.parse(settingsRaw) : {};
    else if (settingsRaw && typeof settingsRaw === "object") s = settingsRaw;
  } catch { /* malformed settings — treat as disabled */ }
  const u = (s.upsell && typeof s.upsell === "object") ? s.upsell as Record<string, unknown> : {};
  const windowMinutes = Number(u.windowMinutes);
  return {
    enabled: u.enabled === true,
    serviceId: typeof u.serviceId === "string" && u.serviceId ? u.serviceId : null,
    windowMinutes: windowMinutes > 0 ? Math.round(windowMinutes) : DEFAULT_WINDOW_MINUTES,
  };
}

export type UpsellOffer = { serviceName: string; staffName: string; date: string; time: string; price: number };

/** Real free slot for the configured upsell service within windowMinutes of
 *  the just-booked appointment's start/end, same day. null = upsell off,
 *  unconfigured, same service as just booked, or genuinely nothing free —
 *  never a guess. */
export async function findUpsellOffer(opts: {
  businessId: string;
  settings: string | Record<string, unknown> | null;
  date: string;              // YYYY-MM-DD of the appointment just booked
  bookedStart: string;       // HH:MM
  bookedEnd: string;         // HH:MM
  excludeServiceId: string;  // don't suggest the same service just booked
}): Promise<UpsellOffer | null> {
  const cfg = getUpsellConfig(opts.settings);
  if (!cfg.enabled || !cfg.serviceId || cfg.serviceId === opts.excludeServiceId) return null;

  const service = await prisma.service.findUnique({
    where: { id: cfg.serviceId },
    select: { id: true, name: true, price: true, durationMinutes: true, isVisible: true, businessId: true },
  });
  if (!service || !service.isVisible || service.businessId !== opts.businessId) return null;

  const avail = await computeDayAvailability(opts.businessId, opts.date, undefined, cfg.serviceId);
  const startMin = timeToMinutes(opts.bookedStart);
  const endMin = timeToMinutes(opts.bookedEnd);

  for (const staffRow of avail) {
    for (const slot of staffRow.slots) {
      const slotMin = timeToMinutes(slot);
      const nearStart = Math.abs(slotMin - startMin) <= cfg.windowMinutes;
      const nearEnd = Math.abs(slotMin - endMin) <= cfg.windowMinutes;
      if (!nearStart && !nearEnd) continue;
      const eff = await resolveStaffService(staffRow.staffId, cfg.serviceId, service.name, service.durationMinutes, service.price);
      return { serviceName: service.name, staffName: staffRow.name, date: opts.date, time: slot, price: eff.price };
    }
  }
  return null;
}
