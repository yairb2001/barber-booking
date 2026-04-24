/**
 * GET  /api/admin/agent  — load agent config
 * PATCH /api/admin/agent — save agent config
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const biz = await prisma.business.findFirst({ select: { id: true } });
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
      faqs:          [],
    });
  }

  return NextResponse.json(config);
}

export async function PATCH(req: NextRequest) {
  const biz = await prisma.business.findFirst({ select: { id: true } });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });

  const body = await req.json();
  const { isEnabled, agentName, systemPrompt, greetingMsg, escalatePhone, maxIdleMinutes } = body;

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
    },
    update: {
      ...(isEnabled      !== undefined && { isEnabled }),
      ...(agentName      !== undefined && { agentName }),
      ...(systemPrompt   !== undefined && { systemPrompt:   systemPrompt   || null }),
      ...(greetingMsg    !== undefined && { greetingMsg:    greetingMsg    || null }),
      ...(escalatePhone  !== undefined && { escalatePhone:  escalatePhone  || null }),
      ...(maxIdleMinutes !== undefined && { maxIdleMinutes }),
    },
    include: { faqs: { orderBy: { sortOrder: "asc" } } },
  });

  return NextResponse.json(config);
}
