/**
 * Which reports go out, and to whom.
 *
 * Stored in Business.settings.reports. The three report crons were previously
 * unconditional — the DEFAULTS below reproduce exactly what they did before this
 * was configurable, so a business that never touches the screen sees no change:
 *
 *   daily   → manager only  (there was no per-barber daily report; the
 *                            barber-daily-summary cron was turned off)
 *   weekly  → manager + each barber's own numbers
 *   monthly → manager + each barber's own numbers
 */

export type ReportKind = "daily" | "weekly" | "monthly";

export type ReportAudience = {
  /** Send the shop-wide report to the business phone + owner login phone. */
  owner: boolean;
  /** Send every barber their own personal numbers. */
  staff: boolean;
};

export type ReportsConfig = Record<ReportKind, ReportAudience>;

export const REPORT_DEFAULTS: ReportsConfig = {
  daily: { owner: true, staff: false },
  weekly: { owner: true, staff: true },
  monthly: { owner: true, staff: true },
};

export const REPORT_KINDS: ReportKind[] = ["daily", "weekly", "monthly"];

function coerce(raw: unknown, fallback: ReportAudience): ReportAudience {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  return {
    owner: typeof r.owner === "boolean" ? r.owner : fallback.owner,
    staff: typeof r.staff === "boolean" ? r.staff : fallback.staff,
  };
}

/**
 * Reads the config out of a Business.settings JSON string. Any missing or
 * malformed piece falls back to the pre-existing behaviour rather than to "off",
 * so a bad write can never silently stop a business's reports.
 */
export function resolveReportsConfig(settingsJson: string | null | undefined): ReportsConfig {
  let raw: unknown;
  try {
    raw = settingsJson ? (JSON.parse(settingsJson) as { reports?: unknown }).reports : undefined;
  } catch {
    raw = undefined;
  }
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    daily: coerce(obj.daily, REPORT_DEFAULTS.daily),
    weekly: coerce(obj.weekly, REPORT_DEFAULTS.weekly),
    monthly: coerce(obj.monthly, REPORT_DEFAULTS.monthly),
  };
}
