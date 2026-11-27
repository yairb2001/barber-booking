/**
 * The least days between two of the same treatment (Service.minGapDays, 27.11.2026): laser on one area every
 * 4 weeks, botox every 4 months. Written only in the business rules, the agent booked legs 14 days after legs
 * and botox after 2 months. The booking tools ask this before they propose or book.
 */
import { prisma } from "@/lib/prisma";
import { addDaysISO } from "@/lib/utils";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Only the treatments before that date: moving his own next one must not refuse itself.
 *  null when every treatment keeps its gap; else a line for the model with the first date that does. */
export async function gapRefusal(businessId: string, customerId: string | null | undefined, serviceIds: string[], date: string): Promise<string | null> {
  if (!customerId || !serviceIds.length) return null;
  const services = await prisma.service.findMany({ where: { businessId, id: { in: serviceIds }, minGapDays: { gt: 0 } }, select: { id: true, name: true, minGapDays: true } });
  for (const s of services) {
    const gap = s.minGapDays!;
    const near = await prisma.appointment.findFirst({
      where: { businessId, customerId, serviceId: s.id, status: { notIn: ["cancelled_by_customer", "cancelled_by_staff", "no_show"] }, date: { gt: new Date(addDaysISO(date, -gap) + "T00:00:00.000Z"), lt: new Date(date + "T00:00:00.000Z") } },
      orderBy: { date: "desc" }, select: { date: true },
    });
    if (!near) continue;
    const last = iso(near.date), from = addDaysISO(last, gap);
    return `שגיאה: ${s.name} היה אצלו ב-${last}, ${Math.abs(daysBetween(last, date))} ימים מ-${date}. בעסק צריך לפחות ${gap} ימים בין שניים כאלה, כלומר מ-${from}. אמור לו את זה בפשטות, והצע תאריך מ-${from} (בדוק עם הכלי).`;
  }
  return null;
}
