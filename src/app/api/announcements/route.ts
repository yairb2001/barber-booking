import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { resolveBusinessId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Resolve businessId from ?slug= / ?businessId= (backward-compat: → findFirst)
  const resolvedBusinessId = (await resolveBusinessId(req)) ?? undefined;

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
