/**
 * GET /api/customers/lookup?q=...
 *
 * Public endpoint — used by the customer-facing booking flow when they select
 * "חבר הביא חבר" as their referral source. Lets them search for the friend
 * who referred them by name.
 *
 * Returns ONLY id + name — phone numbers are never exposed publicly (a customer
 * shouldn't see other customers' phone numbers when crediting a friend).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();

  if (q.length < 2) {
    return NextResponse.json([]);
  }

  // Get the first (and currently only) business
  const business = await prisma.business.findFirst({ select: { id: true } });
  if (!business) return NextResponse.json([]);

  const customers = await prisma.customer.findMany({
    where: {
      businessId: business.id,
      name: { contains: q, mode: "insensitive" },
      isBlocked: false,
    },
    select: { id: true, name: true },
    take: 8,
    orderBy: { name: "asc" },
  });

  // id + name only — never expose phone numbers to other customers.
  return NextResponse.json(customers);
}
