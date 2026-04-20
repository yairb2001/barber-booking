import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json([]);

  const customers = await prisma.customer.findMany({
    where: {
      businessId: business.id,
      isBlocked: false,
      ...(q ? {
        OR: [
          { name: { contains: q } },
          { phone: { contains: q } },
        ],
      } : {}),
    },
    orderBy: { name: "asc" },
    take: 30,
  });
  return NextResponse.json(customers);
}
