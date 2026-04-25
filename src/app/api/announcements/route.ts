import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const announcements = await prisma.announcement.findMany({
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
