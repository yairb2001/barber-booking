/**
 * Which plan fits a business (16.10.2026, Yair approved: "צריך להמליץ בצורה
 * שונה לעסקים שונים ... עסק של לק זה 300 תורים", and again in setup, once the
 * team is known). A plan is a message quota; appointments are the estimate:
 * every appointment sends about 6 messages (the agent's replies, confirmation,
 * reminders, system messages; measured at DOMINANT: 5.4 to 5.9).
 * No server imports: used on /signup, in the setup wizard and on the plan screen.
 */
export const MESSAGES_PER_APPT = 6;

/** Appointments a month for one person working full time. */
export const APPTS_PER_PERSON: Record<string, number> = { barber_men: 250, barber_women: 150, nails: 120, cosmetics: 90, other: 120 };
/** A typical business of the type, before we know its team (signup). */
export const TYPICAL_BUSINESS: Record<string, number> = { barber_men: 600, barber_women: 400, nails: 300, cosmetics: 200, other: 300 };

export const estimateAppts = (type: string | null | undefined, people: number) =>
  Math.max(1, people) * (APPTS_PER_PERSON[type ?? ""] ?? APPTS_PER_PERSON.other);

type PlanLike = { key: string; name: string; priceIls: number; apptsCap?: number; apptsEstimate?: number };
const capOf = (p: PlanLike) => p.apptsCap ?? p.apptsEstimate ?? 0;

/** The cheapest plan that fits the appointments, else the biggest. */
export function recommendPlan<P extends PlanLike>(plans: P[], appts: number): P | null {
  const sorted = [...plans].sort((a, b) => a.priceIls - b.priceIls);
  return sorted.find(p => capOf(p) >= appts) ?? sorted[sorted.length - 1] ?? null;
}

/** What a plan's messages are, in the owner's words. */
export const MESSAGES_EXPLAINED = "ההודעות כוללות את התשובות של הסוכן, אישורים ותזכורות והודעות מערכת. בערך 6 הודעות לכל תור, ולכן המסלול מחושב לפי מספר התורים";
