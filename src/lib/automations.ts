/**
 * Post-visit automation helpers.
 * Called from appointments PATCH when status transitions to "completed".
 */
import { prisma } from "./prisma";
import { sendMessage } from "./messaging";

type ApptRef = {
  id: string;
  businessId: string;
  customerId: string;
  staffId: string;
  serviceId: string;
};

/**
 * Fire any active post_first_visit / post_every_visit automations
 * for a just-completed appointment.
 */
export async function triggerPostVisitAutomations(appt: ApptRef): Promise<void> {
  const automations = await prisma.automation.findMany({
    where: {
      businessId: appt.businessId,
      type: { in: ["post_first_visit", "post_every_visit"] },
      active: true,
    },
  });
  if (!automations.length) return;

  // Resolve relations
  const [customer, business, staff, service] = await Promise.all([
    prisma.customer.findUnique({ where: { id: appt.customerId } }),
    prisma.business.findFirst({ where: { id: appt.businessId } }),
    prisma.staff.findUnique({ where: { id: appt.staffId } }),
    prisma.service.findUnique({ where: { id: appt.serviceId } }),
  ]);
  if (!customer || !business) return;

  // Count how many completed appointments this customer now has
  const completedCount = await prisma.appointment.count({
    where: {
      customerId: appt.customerId,
      businessId: appt.businessId,
      status: "completed",
    },
  });

  for (const auto of automations) {
    let settings: Record<string, unknown>;
    try { settings = JSON.parse(auto.settings || "{}"); } catch { settings = {}; }

    // ── post_first_visit ───────────────────────────────────────────────────────
    if (auto.type === "post_first_visit") {
      // Only on the very first completed appointment
      if (completedCount !== 1) continue;

      // Dedup: don't send if we already sent this to the customer before
      const already = await prisma.messageLog.findFirst({
        where: {
          businessId: appt.businessId,
          customerPhone: customer.phone,
          kind: "post_first_visit",
          status: { not: "failed" },
        },
      });
      if (already) continue;

      const ctaType = (settings.ctaType as string) ?? "google_review";
      const ctaUrl  = (settings.ctaUrl  as string) ?? "";

      let ctaLine = "";
      if (ctaType === "google_review" && ctaUrl)
        ctaLine = `\n\n⭐ נשמח לביקורת קצרה בגוגל — זה עוזר לנו המון:\n${ctaUrl}`;
      else if (ctaType === "instagram" && ctaUrl)
        ctaLine = `\n\n📸 עקוב אחרינו באינסטגרם:\n${ctaUrl}`;
      else if (ctaType === "custom" && ctaUrl)
        ctaLine = `\n\n${ctaUrl}`;

      const template = (auto.template as string | null) ||
        `שלום {{name}} 👋\n\nתודה שביקרת אצלנו ב*{{business}}* לראשונה ✂️\nנהנינו מאוד לטפל בך 😊{{cta}}\n\nנתראה בפעם הבאה!`;

      const body = template
        .replace(/\{\{name\}\}/g, customer.name)
        .replace(/\{\{business\}\}/g, business.name)
        .replace(/\{\{staff\}\}/g, staff?.name ?? "")
        .replace(/\{\{service\}\}/g, service?.name ?? "")
        .replace(/\{\{cta\}\}/g, ctaLine);

      sendMessage({
        businessId: appt.businessId,
        appointmentId: appt.id,
        customerPhone: customer.phone,
        kind: "post_first_visit",
        body,
      }).catch(console.error);
    }

    // ── post_every_visit ──────────────────────────────────────────────────────
    if (auto.type === "post_every_visit") {
      const segment   = (settings.segment   as string) ?? "regular_only";
      const minVisits = (settings.minVisits as number) ?? 2;

      // Segment gate
      if (segment === "regular_only" && completedCount < minVisits) continue;
      if (segment === "new_only"     && completedCount !== 1) continue;

      const template = (auto.template as string | null) ||
        `שלום {{name}} 👋\n\nתודה שביקרת ב*{{business}}* ✂️\nנתראה בפעם הבאה! 😊`;

      const body = template
        .replace(/\{\{name\}\}/g, customer.name)
        .replace(/\{\{business\}\}/g, business.name)
        .replace(/\{\{staff\}\}/g, staff?.name ?? "")
        .replace(/\{\{service\}\}/g, service?.name ?? "");

      sendMessage({
        businessId: appt.businessId,
        appointmentId: appt.id,
        customerPhone: customer.phone,
        kind: "post_every_visit",
        body,
      }).catch(console.error);
    }
  }
}
