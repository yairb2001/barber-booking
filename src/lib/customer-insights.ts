/**
 * Derived facts about a customer from their appointment history — one place
 * so the customer card, the appointment card's history modal, the customers
 * list and the agent all say the same thing.
 *
 * "Visit" = an appointment whose date+endTime is in the past and that was not
 * cancelled / no-show (completion is derived, never a manual status — see
 * CLAUDE.md). Input rows must belong to ONE customer.
 */

export type InsightAppt = {
  date: Date | string;
  startTime: string;
  endTime: string;
  status: string;
  staffId: string;
  serviceId: string;
  customServiceName?: string | null;
  staff?: { name: string } | null;
  service?: { name: string } | null;
};

export type CustomerInsights = {
  visits: number;
  cancelled: number;          // cancelled by customer or staff
  noShows: number;
  lastVisitAt: string | null; // ISO date of the last completed visit
  lastVisitDaysAgo: number | null;
  avgIntervalDays: number | null; // mean gap between consecutive visits (≥2 visits)
  expectedReturnInDays: number | null; // avgInterval - daysSinceLast (negative = overdue)
  usual: {
    serviceId: string; serviceName: string;
    staffId: string; staffName: string;
    weekday: number | null; // 0=Sun … 6=Sat, most common (tie → most recent)
    hour: string | null;    // "HH:MM" — typical start inside the usual time-of-day (median), for prefills only
    timeOfDay: TimeOfDay | null; // THE measure of "his hours": בוקר / צהריים / ערב
  } | null;
  // Customer used to visit one barber and now visits another.
  switchedBarber: { fromName: string; toName: string; sinceISO: string } | null;
};

const DAY = 86_400_000;
const isoDay = (d: Date | string) => (typeof d === "string" ? d : d.toISOString()).slice(0, 10);

/** Most frequent value; a tie goes to the one seen most RECENTLY (input is oldest→newest). */
function mode<T>(xs: T[]): T | null {
  if (!xs.length) return null;
  const count = new Map<T, number>();
  const lastIdx = new Map<T, number>();
  xs.forEach((x, i) => { count.set(x, (count.get(x) || 0) + 1); lastIdx.set(x, i); });
  return Array.from(count.entries()).sort((a, b) => b[1] - a[1] || (lastIdx.get(b[0])! - lastIdx.get(a[0])!))[0][0];
}

export type TimeOfDay = "morning" | "afternoon" | "evening";
export const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = { morning: "בבוקר", afternoon: "בצהריים", evening: "בערב" };
/** בוקר < 12:00 · צהריים 12:00–17:00 · ערב ≥ 17:00 */
export function timeOfDayOf(hhmm: string): TimeOfDay {
  const h = Number(hhmm.slice(0, 2));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

export function computeCustomerInsights(rows: InsightAppt[], now = new Date()): CustomerInsights {
  const cancelled = rows.filter(a => a.status.startsWith("cancelled")).length;
  const noShows = rows.filter(a => a.status === "no_show").length;

  // Completed visits: in the past, not cancelled/no-show.
  const visits = rows
    .filter(a => !a.status.startsWith("cancelled") && a.status !== "no_show")
    .filter(a => new Date(isoDay(a.date) + "T" + (a.endTime || a.startTime || "00:00") + ":00").getTime() <= now.getTime())
    .sort((a, b) => isoDay(a.date).localeCompare(isoDay(b.date)) || a.startTime.localeCompare(b.startTime));

  const lastVisit = visits[visits.length - 1] || null;
  const lastVisitAt = lastVisit ? isoDay(lastVisit.date) : null;
  const lastVisitDaysAgo = lastVisitAt ? Math.floor((now.getTime() - new Date(lastVisitAt + "T00:00:00").getTime()) / DAY) : null;

  // Average gap between consecutive visits (ignore same-day duplicates).
  const days = Array.from(new Set(visits.map(v => isoDay(v.date)))).map(d => new Date(d + "T00:00:00").getTime());
  let avgIntervalDays: number | null = null;
  if (days.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < days.length; i++) gaps.push((days[i] - days[i - 1]) / DAY);
    // Use the last 6 gaps — recent rhythm matters more than a year-old one.
    const recent = gaps.slice(-6);
    avgIntervalDays = Math.round(recent.reduce((s, g) => s + g, 0) / recent.length);
  }
  const expectedReturnInDays = avgIntervalDays !== null && lastVisitDaysAgo !== null ? avgIntervalDays - lastVisitDaysAgo : null;

  // "Usual": most frequent service / barber / weekday / time over the last 12 visits.
  let usual: CustomerInsights["usual"] = null;
  const recentVisits = visits.slice(-12);
  if (recentVisits.length) {
    const svcId = mode(recentVisits.map(v => v.serviceId))!;
    const svcRow = [...recentVisits].reverse().find(v => v.serviceId === svcId)!;
    const staffId = mode(recentVisits.map(v => v.staffId))!;
    const staffRow = [...recentVisits].reverse().find(v => v.staffId === staffId)!;
    const weekday = mode(recentVisits.map(v => new Date(isoDay(v.date) + "T00:00:00").getDay()));
    // "His hours" = the most common time-of-day bucket, not a specific clock
    // time (one visit at 16:30 must not make 16:30 "his usual").
    const timeOfDay = mode(recentVisits.map(v => timeOfDayOf(v.startTime)));
    // A representative clock time inside that bucket (median) — used only to
    // pre-fill forms (recurring rule), never as the customer's preference.
    let hourKey: string | null = null;
    if (timeOfDay) {
      const mins = recentVisits.filter(v => timeOfDayOf(v.startTime) === timeOfDay)
        .map(v => { const [h, m] = v.startTime.split(":").map(Number); return h * 60 + m; }).sort((a, b) => a - b);
      const med = mins[Math.floor(mins.length / 2)];
      const rounded = Math.round(med / 30) * 30;
      hourKey = `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
    }
    usual = {
      serviceId: svcId,
      serviceName: svcRow.customServiceName || svcRow.service?.name || "",
      staffId,
      staffName: staffRow.staff?.name || "",
      weekday,
      hour: hourKey,
      timeOfDay,
    };
  }

  // Switched barber: the last 3 visits are all with barber B, and before that
  // there were ≥3 visits with a different barber A.
  let switchedBarber: CustomerInsights["switchedBarber"] = null;
  if (visits.length >= 6) {
    const last3 = visits.slice(-3);
    const toId = last3[0].staffId;
    if (last3.every(v => v.staffId === toId)) {
      const before = visits.slice(0, -3);
      const prevId = mode(before.map(v => v.staffId));
      const prevCount = before.filter(v => v.staffId === prevId).length;
      if (prevId && prevId !== toId && prevCount >= 3) {
        const fromRow = before.find(v => v.staffId === prevId)!;
        switchedBarber = {
          fromName: fromRow.staff?.name || "",
          toName: last3[0].staff?.name || "",
          sinceISO: isoDay(last3[0].date),
        };
      }
    }
  }

  return { visits: visits.length, cancelled, noShows, lastVisitAt, lastVisitDaysAgo, avgIntervalDays, expectedReturnInDays, usual, switchedBarber };
}

export const HEB_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** One-line Hebrew summary for cards: "14 ביקורים · כל 24 יום · ביקור אחרון לפני 19 יום · צפוי לחזור בעוד ~5 ימים". */
export function insightsSummaryLine(i: CustomerInsights): string {
  const parts: string[] = [];
  parts.push(i.visits === 0 ? "לקוח חדש" : i.visits === 1 ? "ביקור אחד" : `${i.visits} ביקורים`);
  if (i.avgIntervalDays) parts.push(`כל ${i.avgIntervalDays} יום`);
  if (i.cancelled) parts.push(`ביטל ${i.cancelled}`);
  if (i.noShows) parts.push(`הבריז ${i.noShows}`);
  if (i.lastVisitDaysAgo !== null) parts.push(i.lastVisitDaysAgo === 0 ? "היה היום" : `ביקור אחרון לפני ${i.lastVisitDaysAgo} יום`);
  if (i.expectedReturnInDays !== null) {
    parts.push(i.expectedReturnInDays > 0 ? `צפוי לחזור בעוד ~${i.expectedReturnInDays} ימים` : i.expectedReturnInDays === 0 ? "צפוי לחזור היום" : `באיחור של ${-i.expectedReturnInDays} ימים`);
  }
  return parts.join(" · ");
}

/** "תספורת + זקן · אצל שימי · בדרך כלל יום רביעי 18:00 · כל 3 שבועות" */
export function usualLine(i: CustomerInsights): string | null {
  if (!i.usual) return null;
  const parts: string[] = [];
  if (i.usual.serviceName) parts.push(i.usual.serviceName);
  if (i.usual.staffName) parts.push(`אצל ${i.usual.staffName}`);
  if (i.usual.weekday !== null || i.usual.timeOfDay) {
    const bits = [i.usual.weekday !== null ? `יום ${HEB_WEEKDAYS[i.usual.weekday]}` : null, i.usual.timeOfDay ? TIME_OF_DAY_LABEL[i.usual.timeOfDay] : null].filter(Boolean);
    parts.push(`בדרך כלל ${bits.join(", ")}`);
  }
  if (i.avgIntervalDays) {
    const w = Math.round(i.avgIntervalDays / 7);
    parts.push(w >= 2 && Math.abs(i.avgIntervalDays - w * 7) <= 2 ? `כל ${w} שבועות` : `כל ${i.avgIntervalDays} יום`);
  }
  return parts.join(" · ");
}
