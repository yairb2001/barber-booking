import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get("businessId");

  // Resolve businessId (backward-compat: no param → findFirst)
  let resolvedBusinessId: string | undefined;
  if (businessId) {
    resolvedBusinessId = businessId;
  } else {
    const biz = await prisma.business.findFirst({ select: { id: true } });
    resolvedBusinessId = biz?.id;
  }

  const announcements = await prisma.announcement.findMany({
    where: resolvedBusinessId ? { businessId: resolvedBusinessId } : {},
    orderBy: [{ isPinned: "desc" }, { sortOrder: "asc" }],
    select: {
      id: true,
      title: true,
      content: true,
      isPinned: true,
      createdAt: true,
    },
  });

  return NextResponse.json(announcements);
}
