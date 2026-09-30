/**
 * GET  /api/admin/agent  — load agent config
 * PATCH /api/admin/agent — save agent config
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBusiness, requireOwner } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });

  const config = await prisma.agentConfig.findUnique({
    where: { businessId: biz.id },
    include: { faqs: { orderBy: { sortOrder: "asc" } } },
  });

  // Return defaults if not yet created
  if (!config) {
    return NextResponse.json({
      isEnabled:     false,
      agentName:     "הסוכן",
      systemPrompt:  null,
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
    });
  }

  return NextResponse.json(config);
}

export async function PATCH(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });

  const body = await req.json();
  const {
    isEnabled, agentName, systemPrompt, greetingMsg, escalatePhone, maxIdleMinutes,
    requireSwapApproval, allowSwapOffers, escalateAfterMessages,
    offerOtherBarberAtRequestedTime,
    lateArrivalEnabled, lateArrivalGraceMinutes, lateArrivalSwapLeadMinutes, lateArrivalOfferSwapWithNext,
    lateArrivalNoShowMessage,
    setupConfig,
  } = body;

  // Setup-interview answers (stage 1 wizard): merge object into the stored JSON.
  let mergedSetup: string | undefined;
  if (setupConfig && typeof setupConfig === "object") {
    const cur = await prisma.agentConfig.findUnique({ where: { businessId: biz.id }, select: { setupConfig: true } });
    let existing: Record<string, unknown> = {};
    try { existing = cur?.setupConfig ? JSON.parse(cur.setupConfig) : {}; } catch { existing = {}; }
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(setupConfig as Record<string, unknown>)) if (typeof v === "string" || typeof v === "boolean") clean[k] = v;
    mergedSetup = JSON.stringify({ ...existing, ...clean });
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
      ...(mergedSetup !== undefined && { setupConfig: mergedSetup }),
    },
    update: {
      ...(mergedSetup !== undefined && { setupConfig: mergedSetup }),
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

  return NextResponse.json(config);
}
