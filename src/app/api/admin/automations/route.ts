import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getBizId(): Promise<string | null> {
  const biz = await prisma.business.findFirst({ select: { id: true } });
  return biz?.id ?? null;
}

// GET — list all automations for this business
export async function GET() {
  const bizId = await getBizId();
  if (!bizId) return NextResponse.json([]);
  const automations = await prisma.automation.findMany({
    where: { businessId: bizId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(automations);
}

// POST — create an automation
export async function POST(req: NextRequest) {
  const bizId = await getBizId();
  if (!bizId) return NextResponse.json({ error: "No business" }, { status: 500 });

  const body = await req.json();
  const automation = await prisma.automation.create({
    data: {
      businessId: bizId,
      type:     body.type,
      name:     body.name,
      active:   body.active   ?? false,
      settings: typeof body.settings === "string" ? body.settings : JSON.stringify(body.settings ?? {}),
      template: body.template ?? null,
    },
  });
  return NextResponse.json(automation);
}
