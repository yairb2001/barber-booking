import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBusiness, requireOwner } from "@/lib/session";

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const business = await getSessionBusiness(req);
  if (!business) return NextResponse.json(null);
  // Never ship the owner-login bcrypt hash to the browser — no UI needs it.
  const { passwordHash: _pw, ...safeBusiness } = business;
  void _pw;
  return NextResponse.json({
    ...safeBusiness,
    socialLinks: business.socialLinks ? JSON.parse(business.socialLinks) : {},
    settings: business.settings ? JSON.parse(business.settings) : {},
  });
}

export async function PATCH(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const body = await req.json();
  const business = await getSessionBusiness(req);
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  // Two ways to write `settings` (a single free-form JSON blob shared by many
  // independent toggles — theme, calendar hours, barber permissions,
  // notifications, ...):
  //   - `settings`: full replacement (existing contract — the CALLER is
  //     responsible for merging, by fetching first). Kept for every existing
  //     caller unchanged.
  //   - `settingsPatch`: a partial object merged HERE, against the business
  //     row already read above (moments old, not however-long-the-tab's-been-
  //     open old). Two callers each sending `settings` full-replacement can
  //     race and silently clobber each other if their saves overlap — this
  //     shrinks that window from "arbitrary" to "a couple concurrent
  //     requests, milliseconds apart". Use this for anything that can be
  //     toggled independently of the rest of the page (see NotificationSettings).
  let mergedSettings: string | undefined;
  if (body.settingsPatch !== undefined) {
    let current: Record<string, unknown> = {};
    try { current = business.settings ? JSON.parse(business.settings) : {}; } catch { /* ignore */ }
    mergedSettings = JSON.stringify({ ...current, ...body.settingsPatch });
  } else if (body.settings !== undefined) {
    mergedSettings = JSON.stringify(body.settings);
  }

  const updated = await prisma.business.update({
    where: { id: business.id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.address !== undefined && { address: body.address }),
      ...(body.about !== undefined && { about: body.about }),
      ...(body.logoUrl !== undefined && { logoUrl: body.logoUrl }),
      ...(body.coverImageUrl !== undefined && { coverImageUrl: body.coverImageUrl }),
      ...(body.brandColor !== undefined && { brandColor: body.brandColor }),
      ...(body.secondaryColor !== undefined && { secondaryColor: body.secondaryColor }),
      ...(body.bgColor !== undefined && { bgColor: body.bgColor }),
      ...(body.textColor !== undefined && { textColor: body.textColor }),
      ...(body.socialLinks !== undefined && {
        socialLinks: JSON.stringify(body.socialLinks),
      }),
      ...(mergedSettings !== undefined && { settings: mergedSettings }),
      // WhatsApp / messaging
      ...(body.whatsappNumber !== undefined && { whatsappNumber: body.whatsappNumber }),
      ...(body.messagingProvider !== undefined && { messagingProvider: body.messagingProvider }),
      ...(body.greenApiInstanceId !== undefined && { greenApiInstanceId: body.greenApiInstanceId }),
      ...(body.greenApiToken !== undefined && { greenApiToken: body.greenApiToken }),
      ...(body.features !== undefined && { features: JSON.stringify(body.features) }),
      // Facebook/Meta Pixel ID (owner-only; null = no pixel)
      ...(body.facebookPixel !== undefined && { facebookPixel: body.facebookPixel?.trim() || null }),
      // Message templates (null = use built-in default)
      ...(body.reminder24hTemplate !== undefined && {
        reminder24hTemplate: body.reminder24hTemplate || null,
      }),
      ...(body.reminder24hNewTemplate !== undefined && {
        reminder24hNewTemplate: body.reminder24hNewTemplate || null,
      }),
      ...(body.reminder24hReturningTemplate !== undefined && {
        reminder24hReturningTemplate: body.reminder24hReturningTemplate || null,
      }),
      ...(body.reminder2hTemplate !== undefined && {
        reminder2hTemplate: body.reminder2hTemplate || null,
      }),
      ...(body.confirmationTemplate !== undefined && {
        confirmationTemplate: body.confirmationTemplate || null,
      }),
      ...(body.swapProposalTemplate !== undefined && {
        swapProposalTemplate: body.swapProposalTemplate || null,
      }),
      ...(body.moveProposalTemplate !== undefined && {
        moveProposalTemplate: body.moveProposalTemplate || null,
      }),
      ...(body.swapConfirmationTemplate !== undefined && {
        swapConfirmationTemplate: body.swapConfirmationTemplate || null,
      }),
      ...(body.appointmentMovedTemplate !== undefined && {
        appointmentMovedTemplate: body.appointmentMovedTemplate || null,
      }),
      ...(body.delayNotificationTemplate !== undefined && {
        delayNotificationTemplate: body.delayNotificationTemplate || null,
      }),
      ...(body.firstBookingTemplate !== undefined && {
        firstBookingTemplate: body.firstBookingTemplate || null,
      }),
      ...(body.walkInTemplate !== undefined && {
        walkInTemplate: body.walkInTemplate || null,
      }),
      ...(body.waitlistNotifyTemplate !== undefined && {
        waitlistNotifyTemplate: body.waitlistNotifyTemplate || null,
      }),
      ...(body.appointmentCancelledTemplate !== undefined && {
        appointmentCancelledTemplate: body.appointmentCancelledTemplate || null,
      }),
      ...(body.appointmentSelfCancelledTemplate !== undefined && {
        appointmentSelfCancelledTemplate: body.appointmentSelfCancelledTemplate || null,
      }),
      // Booking calendar
      ...(body.bookingHorizonDays !== undefined && {
        bookingHorizonDays: Number(body.bookingHorizonDays) || 30,
      }),
      ...(body.minBookingLeadMinutes !== undefined && {
        minBookingLeadMinutes: Math.max(0, Number(body.minBookingLeadMinutes) || 0),
      }),
      ...(body.firstApptLeadMinutes !== undefined && {
        firstApptLeadMinutes: Math.max(0, Number(body.firstApptLeadMinutes) || 0),
      }),
      // Chats feature toggle
      ...(body.chatsEnabled !== undefined && { chatsEnabled: Boolean(body.chatsEnabled) }),
      // Whether barbers manage their own services (vs owner controls all)
      ...(body.staffManageOwnServices !== undefined && { staffManageOwnServices: Boolean(body.staffManageOwnServices) }),
      // Cancellation policy: who controls the minimum-notice window (owner sets
      // one value for everyone, or each barber sets their own) + the global/
      // fallback hours value itself.
      ...(body.cancellationPolicyMode !== undefined && {
        cancellationPolicyMode: body.cancellationPolicyMode === "staff" ? "staff" : "owner",
      }),
      ...(body.minCancellationHours !== undefined && {
        minCancellationHours: Math.max(0, Number(body.minCancellationHours) || 0),
      }),
      ...(body.cancellationPolicyText !== undefined && {
        cancellationPolicyText: body.cancellationPolicyText?.trim() || null,
      }),
      // Re-engagement automation
      ...(body.reengageEnabled !== undefined && { reengageEnabled: Boolean(body.reengageEnabled) }),
      ...(body.reengageWeeks   !== undefined && { reengageWeeks:   Number(body.reengageWeeks) || 6 }),
      ...(body.reengageTemplate !== undefined && {
        reengageTemplate: body.reengageTemplate || null,
      }),
    },
  });
  return NextResponse.json(updated);
}
