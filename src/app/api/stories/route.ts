import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveBusinessId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const businessId = await resolveBusinessId(req);
  if (!businessId) return NextResponse.json([]);

  const now = new Date();
  const stories = await prisma.story.findMany({
    where: {
      businessId,
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
    orderBy: { sortOrder: "asc" },
    include: { staff: { select: { id: true, name: true, avatarUrl: true } } },
  });

  return NextResponse.json(interleaveByStaff(stories));
}

/**
 * Reorders stories so two stories from the SAME barber are never adjacent
 * (as much as mathematically possible). Greedy: always emit the next story
 * from the barber with the most remaining, skipping the one just emitted.
 * Order within each barber is preserved (still by sortOrder). Stories with no
 * staff are treated as unique so they never count as "same barber".
 */
function interleaveByStaff<T extends { id: string; staff: { id: string } | null }>(items: T[]): T[] {
  if (items.length <= 1) return items;

  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const key = it.staff?.id ?? `__solo_${it.id}`;
    const arr = buckets.get(key);
    if (arr) arr.push(it); else buckets.set(key, [it]);
  }

  const result: T[] = [];
  let lastKey: string | null = null;
  while (result.length < items.length) {
    const entries = Array.from(buckets.entries());
    let bestKey: string | null = null;
    let bestLen = 0;
    for (const [key, arr] of entries) {
      if (arr.length === 0 || key === lastKey) continue;
      if (arr.length > bestLen) { bestLen = arr.length; bestKey = key; }
    }
    // Only the last-used barber has stories left → unavoidable run.
    if (bestKey === null) {
      for (const [key, arr] of entries) { if (arr.length > 0) { bestKey = key; break; } }
    }
    if (bestKey === null) break;
    result.push(buckets.get(bestKey)!.shift()!);
    lastKey = bestKey;
  }
  return result;
}
