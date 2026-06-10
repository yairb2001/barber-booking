import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { resolveBusinessId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const businessId = await resolveBusinessId(req);
  if (!businessId) return NextResponse.json([]);
  const products = await prisma.product.findMany({
    where: { isVisible: true, businessId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      imageUrl: true,
    },
  });

  return NextResponse.json(products);
}
