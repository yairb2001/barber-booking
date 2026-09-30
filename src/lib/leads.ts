/**
 * Stage 1 (docs/PLAN-MASTER.md §3): from a closed lead to a live business.
 *
 * Yair closes the deal in a call and marks the lead "won" (or presses "צור
 * עסק מליד"); this creates the tenant — type from the lead (barber_men by
 * default), premium tier, the launch price, a free first month — and sends the
 * owner a personal onboarding link on WhatsApp from the demo shop's number
 * (the number he already chatted with). The link signs him in as the owner
 * for the wizard; no password yet (he sets one inside the wizard).
 */
import { prisma } from "@/lib/prisma";
import { generateSlug } from "@/lib/tenant";
import { signOnboardingToken } from "@/lib/auth";
import { sendMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { notifyPlatformOwner } from "@/lib/super-admin";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { isBusinessType, DEFAULT_BUSINESS_TYPE } from "@/lib/vocab";

/** Launch offer (decision 29.9): 287 ₪/month for the first 20 shops, first month free. */
export const LAUNCH_MONTHLY_PRICE = 287;
export const FREE_FIRST_MONTH_DAYS = 30;

const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";

export function onboardingLinkFor(token: string): string {
  return `${APP_URL}/api/onboarding-link?t=${encodeURIComponent(token)}`;
}

export async function createBusinessFromLead(leadId: string): Promise<{ businessId: string; slug: string; link: string; sent: boolean; created: boolean }> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error("lead not found");

  let businessId = lead.businessId;
  let slug: string;
  let created = false;
  if (businessId) {
    const b = await prisma.business.findUnique({ where: { id: businessId }, select: { slug: true } });
    if (!b) throw new Error("business of this lead no longer exists");
    slug = b.slug;
  } else {
    const firstName = (lead.name ?? "").trim().split(/\s+/)[0] || "";
    const name = (lead.businessName ?? "").trim() || (firstName ? `המספרה של ${firstName}` : `מספרה ${lead.phone.slice(-4)}`);
    slug = await generateSlug(name);
    const phone = lead.phone;
    const biz = await prisma.business.create({
      data: {
        name, slug, phone,
        businessType: isBusinessType(lead.businessType) ? lead.businessType : DEFAULT_BUSINESS_TYPE,
        tier: "premium",
        monthlyPrice: LAUNCH_MONTHLY_PRICE,
        trialEndsAt: new Date(Date.now() + FREE_FIRST_MONTH_DAYS * 86400_000),
        whatsappStatus: "not_requested",
        settings: JSON.stringify({ ownerLoginPhone: phone, leadId: lead.id }),
        agentConfig: { create: { isEnabled: false } },
      },
      select: { id: true },
    });
    businessId = biz.id;
    created = true;
    await prisma.lead.update({ where: { id: lead.id }, data: { businessId, status: "won" } });
  }

  const token = await signOnboardingToken(businessId);
  const link = onboardingLinkFor(token);
  const firstName = (lead.name ?? "").trim().split(/\s+/)[0];
  const body = `היי${firstName ? ` ${firstName}` : ""}, כאן Chator. יאיר סגר איתך, אז הנה הקישור האישי להקמת המערכת${lead.businessName ? ` ל${lead.businessName}` : ""}:\n${link}\n\nלוקח כ‑10 דקות מהנייד, וכל שלב נשמר. הקישור אישי ותקף לשבוע.`;
  let sent = false;
  try {
    await sendMessage({ businessId: DEMO_BUSINESS_ID, customerPhone: normalizeIsraeliPhone(lead.phone), kind: "sales_reply", body });
    sent = true;
  } catch (e) {
    console.error("[leads] onboarding link send failed", e);
  }
  notifyPlatformOwner(`🏪 ${created ? "עסק נוצר מליד" : "קישור הקמה נשלח שוב"}: ${lead.businessName || lead.name || lead.phone}\nקישור: ${link}\n${sent ? "נשלח לבעל העסק בוואטסאפ מהמספר של הדמו." : "השליחה נכשלה — שלח לו את הקישור ידנית."}`).catch(() => {});
  return { businessId, slug, link, sent, created };
}
