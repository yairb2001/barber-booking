/**
 * POST  /api/admin/agent/faqs        — add FAQ
 * PUT   /api/admin/agent/faqs        — replace all FAQs
 * DELETE /api/admin/agent/faqs?id=.. — delete one FAQ
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getOrCreateConfig(bizId: string) {
  return prisma.agentConfig.upsert({
    where:  { businessId: bizId },
    create: { businessId: bizId },
    update: {},
  });
}

export async function POST(req: NextRequest) {
  const biz = await prisma.business.findFirst({ select: { id: true } });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });

  const config = await getOrCreateConfig(biz.id);
  const { question, answer, sortOrder } = await req.json();

  if (!question?.trim() || !answer?.trim()) {
    return NextResponse.json({ error: "question and answer required" }, { status: 400 });
  }

  const faq = await prisma.agentFAQ.create({
    data: { agentConfigId: config.id, question, answer, sortOrder: sortOrder ?? 0 },
  });

  return NextResponse.json(faq);
}

export async function PUT(req: NextRequest) {
  const biz = await prisma.business.findFirst({ select: { id: true } });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });

  const config = await getOrCreateConfig(biz.id);
  const { faqs } = await req.json() as { faqs: Array<{ id?: string; question: string; answer: string; sortOrder?: number }> };

  // Delete all existing and recreate
  await prisma.agentFAQ.deleteMany({ where: { agentConfigId: config.id } });
  const created = await prisma.$transaction(
    faqs.map((f, i) =>
      prisma.agentFAQ.create({
        data: { agentConfigId: config.id, question: f.question, answer: f.answer, sortOrder: f.sortOrder ?? i },
      })
    )
  );

  return NextResponse.json(created);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await prisma.agentFAQ.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
