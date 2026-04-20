import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const staff = await prisma.staff.findMany({
    where: { isAvailable: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      nickname: true,
      avatarUrl: true,
      role: true,
      isAvailable: true,
      inQuickPool: true,
      portfolio: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          imageUrl: true,
          caption: true,
        },
      },
    },
  });

  return NextResponse.json(staff);
}
