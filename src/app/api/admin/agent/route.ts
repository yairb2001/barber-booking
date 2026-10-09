/**
 * GET  /api/admin/agent  — load agent config (+ the setup questions, the last
 *                          answer versions, and whether the raw prompt is editable)
 * PATCH /api/admin/agent — save agent config
 *
 * The raw prompt (systemPrompt) is platform-only (spec 10.10.2026): a shop
 * shapes its agent through the setup answers, each of which fills its own
 * section of the base prompt. Only the platform owner, also while
 * impersonating, sees or edits the raw text.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { isPlatformStaff } from "@/lib/super-admin";
import { setupFieldsFor, PLATFORM_ONLY_SETUP_KEYS } from "@/lib/agent/setup-fields";
import { saveSetupAnswers, restoreSetupVersion } from "@/lib/agent/setup-save";

export const dynamic = "force-dynamic";

const AUTHOR_LABEL: Record<string, string> = { owner: "בעל העסק", wizard: "אשף ההקמה", owner_agent: "הסוכן האישי", crm: "צוות צ'אטור" };

async function setupMeta(businessId: string, businessType: string | null) {
  const history = await prisma.agentSetupHistory.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, author: true, createdAt: true } });
  return {
    fields: setupFieldsFor(businessType).map(f => ({ key: f.key, label: f.label, group: f.group, question: f.question, type: f.type, options: f.options ?? null, default: f.default ?? null, core: f.core, multiline: !!f.multiline })),
    history: history.map(h => ({ id: h.id, author: AUTHOR_LABEL[h.author] ?? h.author, createdAt: h.createdAt })),
  };
}

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true, businessType: true });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });

  const [config, meta, canEditPrompt] = await Promise.all([
    prisma.agentConfig.findUnique({
      where: { businessId: biz.id },
      include: { faqs: { orderBy: { sortOrder: "asc" } } },
    }),
    setupMeta(biz.id, biz.businessType),
    isPlatformStaff(req),
  ]);

  // Return defaults if not yet created
  if (!config) {
    return NextResponse.json({
      isEnabled:     false,
      agentName:     "הסוכן",
      systemPrompt:  null,
      hasCustomPrompt: false,
      setupConfig:   null,
      greetingMsg:   null,
      escalatePhone: null,
      maxIdleMinutes: 30,
      requireSwapApproval: true,
      allowSwapOffers: true,
      escalateAfterMessages: 14,
      offerOtherBarberAtRequestedTime: false,
      lateArrivalEnabled: false,
      lateArrivalGraceMinutes: 10,
      lateArrivalSwapLeadMinutes: 40,
      lateArrivalOfferSwapWithNext: false,
      lateArrivalNoShowMessage: null,
      faqs:          [],
      ...meta, canEditPrompt,
    });
  }

  return NextResponse.json({
    ...config,
    systemPrompt: canEditPrompt ? config.systemPrompt : null,
    hasCustomPrompt: !!config.systemPrompt?.trim(),
    ...meta, canEditPrompt,
  });
}

export async function PATCH(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true, businessType: true });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });

  const body = await req.json();
  const {
    isEnabled, agentName, greetingMsg, escalatePhone, maxIdleMinutes,
    requireSwapApproval, allowSwapOffers, escalateAfterMessages,
    offerOtherBarberAtRequestedTime,
    lateArrivalEnabled, lateArrivalGraceMinutes, lateArrivalSwapLeadMinutes, lateArrivalOfferSwapWithNext,
    lateArrivalNoShowMessage,
    setupConfig, restoreSetupId,
  } = body;
  // A shop never writes the raw prompt or the platform's notes; stray fields are ignored.
  const staff = await isPlatformStaff(req);
  const systemPrompt = staff ? body.systemPrompt : undefined;

  // Setup answers: merged, saved and versioned in one place (setup-save.ts).
  if (setupConfig && typeof setupConfig === "object") {
    const patch = Object.fromEntries(Object.entries(setupConfig as Record<string, unknown>).filter(([k]) => staff || !PLATFORM_ONLY_SETUP_KEYS.has(k)));
    await saveSetupAnswers(biz.id, patch, body.author === "wizard" ? "wizard" : "owner");
  }
  if (typeof restoreSetupId === "string") {
    if (!(await restoreSetupVersion(biz.id, restoreSetupId, "owner"))) return NextResponse.json({ error: "version not found" }, { status: 404 });
  }

  const config = await prisma.agentConfig.upsert({
    where:  { businessId: biz.id },
    create: {
      businessId:     biz.id,
      isEnabled:      isEnabled  ?? false,
      agentName:      agentName  ?? "הסוכן",
      systemPrompt:   systemPrompt   || null,
      greetingMsg:    greetingMsg    || null,
      escalatePhone:  escalatePhone  || null,
      maxIdleMinutes: maxIdleMinutes ?? 30,
      requireSwapApproval: requireSwapApproval ?? true,
      allowSwapOffers: allowSwapOffers ?? true,
      escalateAfterMessages: escalateAfterMessages ?? 14,
      offerOtherBarberAtRequestedTime: offerOtherBarberAtRequestedTime ?? false,
      lateArrivalEnabled: lateArrivalEnabled ?? false,
      lateArrivalGraceMinutes: lateArrivalGraceMinutes ?? 10,
      lateArrivalSwapLeadMinutes: lateArrivalSwapLeadMinutes ?? 40,
      lateArrivalOfferSwapWithNext: lateArrivalOfferSwapWithNext ?? false,
      lateArrivalNoShowMessage: lateArrivalNoShowMessage || null,
    },
    update: {
      ...(isEnabled      !== undefined && { isEnabled }),
      ...(agentName      !== undefined && { agentName }),
      ...(systemPrompt   !== undefined && { systemPrompt:   systemPrompt   || null }),
      ...(greetingMsg    !== undefined && { greetingMsg:    greetingMsg    || null }),
      ...(escalatePhone  !== undefined && { escalatePhone:  escalatePhone  || null }),
      ...(maxIdleMinutes !== undefined && { maxIdleMinutes }),
      ...(requireSwapApproval !== undefined && { requireSwapApproval }),
      ...(allowSwapOffers !== undefined && { allowSwapOffers }),
      ...(escalateAfterMessages !== undefined && { escalateAfterMessages }),
      ...(offerOtherBarberAtRequestedTime !== undefined && { offerOtherBarberAtRequestedTime }),
      ...(lateArrivalEnabled !== undefined && { lateArrivalEnabled }),
      ...(lateArrivalGraceMinutes !== undefined && { lateArrivalGraceMinutes }),
      ...(lateArrivalSwapLeadMinutes !== undefined && { lateArrivalSwapLeadMinutes }),
      ...(lateArrivalOfferSwapWithNext !== undefined && { lateArrivalOfferSwapWithNext }),
      ...(lateArrivalNoShowMessage !== undefined && { lateArrivalNoShowMessage: lateArrivalNoShowMessage || null }),
    },
    include: { faqs: { orderBy: { sortOrder: "asc" } } },
  });

  const canEditPrompt = systemPrompt !== undefined || (await isPlatformStaff(req));
  return NextResponse.json({
    ...config,
    systemPrompt: canEditPrompt ? config.systemPrompt : null,
    hasCustomPrompt: !!config.systemPrompt?.trim(),
    ...(await setupMeta(biz.id, biz.businessType)), canEditPrompt,
  });
}
