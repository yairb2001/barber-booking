/**
 * The check before "הפעל" (28.10.2026, spec "הקמה עצמית ליופי"): what in the
 * team and services would make the agent book wrong. Counted from the rows,
 * without the agent. Each one stops "הפעל" until it is fixed (or the service
 * is hidden); `step` is the wizard screen that fixes it.
 */
import { prisma } from "@/lib/prisma";
import { vocabOf } from "@/lib/vocab";
import { domainsOf, CONSULT_FIRST_NOTE } from "@/lib/domains";
import { strictServices } from "@/lib/agent/availability";

export type SetupIssue = { key: string; text: string; step: 2 | 3; serviceId?: string };

export async function setupIssues(businessId: string): Promise<SetupIssue[]> {
  const [biz, staff, services] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { businessType: true, settings: true } }),
    prisma.staff.findMany({ where: { businessId, isAvailable: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, gender: true, staffServices: { select: { serviceId: true } }, schedules: { where: { isWorking: true }, select: { dayOfWeek: true } } } }),
    prisma.service.findMany({ where: { businessId, isVisible: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, note: true } }),
  ]);
  if (!biz) return [];
  const v = vocabOf(biz);
  // A men's barbershop keeps the old reading: someone with no services marked does them all.
  const strict = strictServices(biz.businessType);
  const does = (s: (typeof staff)[number], serviceId: string) => s.staffServices.some(x => x.serviceId === serviceId) || (!strict && !s.staffServices.length);
  const issues: SetupIssue[] = [];

  for (const sv of services) {
    if (!staff.some(s => does(s, sv.id))) issues.push({ key: `nobody:${sv.id}`, text: `"${sv.name}": אף אחד לא מסומן שעושה אותו`, step: 3, serviceId: sv.id });
  }
  const domains = domainsOf(biz);
  const mixed = domains.includes("barber_men") && domains.length > 1;
  for (const s of staff) {
    if (strict && !s.staffServices.length) issues.push({ key: `idle:${s.id}`, text: `ל${s.name} אין אף שירות. מי שלא מקבל לקוחות, אפשר להסיר מהצוות`, step: 3 });
    if (!s.schedules.length) issues.push({ key: `nodays:${s.id}`, text: `ל${s.name} אין אף יום עבודה`, step: 2 });
    if (mixed && !s.gender) issues.push({ key: `gender:${s.id}`, text: `לסמן אם ${s.name} אישה, גבר או לא לציין`, step: 2 });
  }
  const seen = new Set<string>();
  for (const sv of services) {
    const n = sv.name.trim();
    if (seen.has(n)) issues.push({ key: `twice:${sv.id}`, text: `שני שירותים בשם "${n}". הסוכן לא ידע איזה מהם`, step: 3, serviceId: sv.id });
    seen.add(n);
  }
  if (services.some(sv => sv.note === CONSULT_FIRST_NOTE) && !services.some(sv => /ייעוץ/.test(sv.name))) {
    issues.push({ key: "consult", text: `יש שירות שבפעם הראשונה ${v.customerFem ? "הלקוחה מקבלת" : "מקבלים"} בו קודם ייעוץ, אבל אין שירות ייעוץ`, step: 3 });
  }
  return issues;
}
