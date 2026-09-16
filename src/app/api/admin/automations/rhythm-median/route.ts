import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";
import { computeCustomerInsights } from "@/lib/customer-insights";

export const dynamic = "force-dynamic";

/** GET — the shop's median visit interval (days) across customers with a rhythm; the default pace for one-visit customers. */
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const customers = await prisma.customer.findMany({
    where: { businessId: session.businessId, deletedAt: null },
    select: { appointments: { select: { date: true, startTime: true, endTime: true, status: true, staffId: true, serviceId: true, customServiceName: true, createdAt: true, staff: { select: { name: true, isAvailable: true } }, service: { select: { name: true } } } } },
  });
  const iv: number[] = [];
  for (const c of customers) { const ins = computeCustomerInsights(c.appointments); if (ins.avgIntervalDays && ins.visits >= 2) iv.push(ins.avgIntervalDays); }
  iv.sort((a, b) => a - b);
  const median = iv.length ? iv[Math.floor(iv.length / 2)] : 21;
  return NextResponse.json({ median, customersWithRhythm: iv.length });
}
