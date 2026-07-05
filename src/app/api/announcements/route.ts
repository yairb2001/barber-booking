import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { resolveBusinessId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Resolve businessId from ?slug= / ?businessId= (no param → root business).
  // null = param supplied but unmatched → return empty (no cross-tenant spill).
  const resolvedBusinessId = await resolveBusinessId(req);
  if (!resolvedBusinessId) return NextResponse.json([]);

  const announcements = await prisma.announcement.findMany({
    where: { businessId: resolvedBusinessId },
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
