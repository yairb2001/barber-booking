/**
 * GET /api/customers/lookup?q=...
 *
 * Public endpoint — used by the customer-facing booking flow when they select
 * "חבר הביא חבר" as their referral source. Lets them search for the friend
 * who referred them by name.
 *
 * Returns limited info (id + name + masked phone) so we don't expose full
 * phone numbers publicly.
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
    select: { id: true, name: true, phone: true },
    take: 8,
    orderBy: { name: "asc" },
  });

  // Mask phone: show only last 3 digits for disambiguation
  const result = customers.map(c => ({
    id: c.id,
    name: c.name,
    displayPhone: c.phone.slice(-3).padStart(c.phone.length, "•"),
  }));

  return NextResponse.json(result);
}
