import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner, getRequestSession } from "@/lib/session";
import { sendMessage, formatBusinessName } from "@/lib/messaging";

// POST /api/admin/automations/[id]/test
// Body: { phone: string }  (defaults to business owner phone)
//
// Renders the automation's message template with sample data and sends it
// to the given phone via WhatsApp. Lets the admin preview the actual content
// they'd send to customers.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const { phone: rawPhone } = await req.json().catch(() => ({}));

  const session = getRequestSession(req)!;
  const automation = await prisma.automation.findUnique({ where: { id: params.id } });
  if (!automation) return NextResponse.json({ error: "automation not found" }, { status: 404 });
  // Tenant isolation: never test/send an automation belonging to another business.
  if (automation.businessId !== session.businessId) {
    return NextResponse.json({ error: "אין הרשאה למשאב זה" }, { status: 403 });
  }

  const business = await prisma.business.findUnique({ where: { id: automation.businessId } });
  if (!business) return NextResponse.json({ error: "no business" }, { status: 400 });

  const phone = (rawPhone || business.phone || "").trim();
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  // Public booking link for {{booking_url}} / {{booking_link}} placeholders
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
  const bookingLink = `${baseUrl}/book`;

  // Sample variables
  const sample = {
    name:         "ישראל ישראלי",
    business:     formatBusinessName(business.name),
    staff:        "הספר",
    service:      "תספורת",
    booking_url:  bookingLink,
    booking_link: bookingLink,
  };

  let settings: Record<string, unknown>;
  try { settings = JSON.parse(automation.settings || "{}"); } catch { settings = {}; }

  // Default templates by type
  const defaults: Record<string, string> = {
    post_first_visit: `שלום {{name}} 👋\n\nתודה שביקרת אצלנו ב*{{business}}* לראשונה ✂️\nנהנינו מאוד לטפל בך 😊{{cta}}\n\nנתראה בפעם הבאה!`,
    post_every_visit: `שלום {{name}} 👋\n\nתודה שביקרת ב*{{business}}* ✂️\nנתראה בפעם הבאה! 😊`,
    reengage:         `שלום {{name}} 👋\n\nמתגעגעים אליך! עבר זמן מאז הביקור האחרון ב*{{business}}*.\nנשמח לראות אותך שוב 💈`,
  };

  // CTA line — applies to both post_first_visit and post_every_visit
  let ctaLine = "";
  if (automation.type === "post_first_visit" || automation.type === "post_every_visit") {
    const ctaType = (settings.ctaType as string) ?? "google_review";
    const ctaUrl  = (settings.ctaUrl  as string) ?? "";
    if (ctaType === "google_review" && ctaUrl) ctaLine = `\n\n⭐ נשמח לביקורת קצרה בגוגל — זה עוזר לנו המון:\n${ctaUrl}`;
    else if (ctaType === "instagram"  && ctaUrl) ctaLine = `\n\n📸 עקוב אחרינו באינסטגרם:\n${ctaUrl}`;
    else if (ctaType === "custom"     && ctaUrl) ctaLine = `\n\n${ctaUrl}`;
  }

  const vars: Record<string, string> = { ...sample, cta: ctaLine };
  // Replace known vars; strip any remaining unknown {{...}} so nothing leaks.
  let body = (automation.template || defaults[automation.type] || "")
    .replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
  body = "🧪 [בדיקה] " + body;

  const result = await sendMessage({
    businessId: business.id,
    customerPhone: phone,
    kind: "manual",
    body,
  });

  return NextResponse.json({ ok: result.ok, error: result.error, sentTo: phone });
}
