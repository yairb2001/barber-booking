import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Public endpoint — returns whether the owner password is set.
 * Used by /admin/login to decide whether to show login or first-run setup.
 *
 * No authentication required (it doesn't reveal sensitive info — only whether
 * a password hash exists at all).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const business = await prisma.business.findFirst({
    select: { id: true, name: true, phone: true, passwordHash: true, settings: true },
  });

  if (!business) {
    return NextResponse.json({ error: "no business" }, { status: 404 });
  }

  // Resolve hint phone (last 4 digits only) so the user knows which phone to use
  let ownerLoginPhone: string | null = null;
  if (business.settings) {
    try {
      const s = JSON.parse(business.settings);
      if (typeof s.ownerLoginPhone === "string") ownerLoginPhone = s.ownerLoginPhone;
    } catch { /* ignore */ }
  }
  const phoneToHint = ownerLoginPhone || business.phone || "";
  const phoneHint = phoneToHint ? phoneToHint.replace(/\D/g, "").slice(-4) : null;

  return NextResponse.json({
    hasOwnerPassword: Boolean(business.passwordHash),
    hasBusinessPhone: Boolean(business.phone || ownerLoginPhone),
    businessName: business.name,
    phoneHint, // last 4 digits — helps owner identify the right phone
  });
}
