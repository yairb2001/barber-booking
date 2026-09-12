import { NextResponse } from "next/server";
import { resolveBusinessId } from "@/lib/tenant";
import { getPreferredServiceId } from "@/lib/preferred-service";
import { getBlockStatus } from "@/lib/customer-block";
import { computeQuickSlots } from "@/lib/quick-slots";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Public: nearest slots for the home carousel (quick pool) or one barber. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const staffIdFilter = searchParams.get("staffId"); // optional: for specific barber

  // Resolve businessId from ?slug= / ?businessId= (no param → root business).
  // null = param supplied but unmatched → scope to nothing (no cross-tenant spill).
  const resolvedBusinessId = await resolveBusinessId(request);
  if (!resolvedBusinessId) return NextResponse.json([]);

  // Returning customer? Offer the service THEY usually book (e.g. cut+beard)
  // instead of the generic base service. null for anonymous/new customers.
  const preferredServiceId = await getPreferredServiceId(request, resolvedBusinessId);
  // A blocked returning customer must never see availability for a barber
  // they're blocked from — see getBlockStatus.
  const blockStatus = await getBlockStatus(request, resolvedBusinessId);

  const slots = await computeQuickSlots({ businessId: resolvedBusinessId, staffIdFilter, preferredServiceId, blockStatus });
  return NextResponse.json(slots);
}
