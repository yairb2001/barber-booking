import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Public search across businesses — matches by shop name OR any staff
// member's name (owner/barber), so a customer can find a shop either way.
// Only businesses that finished onboarding are discoverable (a half-set-up
// signup shouldn't surface to a real customer).
//
// Every business is searchable by default — there's no per-business opt-out
// yet. Worth adding a "listed in directory" toggle if that becomes a real
// concern once there are more (possibly competing) shops on the platform.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  const excludeSlug = req.nextUrl.searchParams.get("exclude") || undefined;
  if (q.length < 2) return NextResponse.json([]);

  const businesses = await prisma.business.findMany({
    where: {
      onboardingCompletedAt: { not: null },
      ...(excludeSlug ? { slug: { not: excludeSlug } } : {}),
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { staff: { some: { name: { contains: q, mode: "insensitive" }, isActive: true } } },
      ],
    },
    select: {
      slug: true,
      name: true,
      logoUrl: true,
      staff: {
        where: { name: { contains: q, mode: "insensitive" }, isActive: true },
        select: { name: true },
        take: 1,
      },
    },
    take: 10,
  });

  return NextResponse.json(
    businesses.map((b) => ({
      slug: b.slug,
      name: b.name,
      logoUrl: b.logoUrl,
      matchedStaffName: b.staff[0]?.name || null,
    }))
  );
}
