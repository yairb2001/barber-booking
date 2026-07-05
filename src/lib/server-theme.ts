import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { resolveTheme, type Theme } from "@/lib/themes";
import { fallbackBusiness, tenantSlugFromPathname } from "@/lib/tenant";

/**
 * Resolve the active business theme on the SERVER so the very first paint
 * already carries the correct palette. Without this, client pages default to
 * THEMES.onyx (gold) until a client-side fetch resolves the real theme —
 * causing a visible "flash" of the wrong theme on every load / refresh.
 *
 * Mirrors exactly what /api/business does (`resolveTheme(settings)`), so the
 * later client fetch returns an identical theme and nothing visibly swaps.
 *
 * MULTI-TENANT: the root layout can't see the `[slug]` route param, so the
 * middleware forwards the visible pathname via the `x-pathname` header. We read
 * it here and resolve the CURRENT tenant's theme — without this the server
 * always painted the root (DOMINANT) theme first, so a slugged shop flashed
 * DOMINANT's palette before the client fetch swapped it.
 *
 * `noStore()` opts this read out of Next's Full Route / Data cache so the
 * server always reflects the CURRENT theme. Without it, after the owner
 * switches themes the server keeps serving the previously cached palette for
 * the first paint (stale) while the client fetch shows the new one → flash.
 */
export async function getServerTheme(): Promise<Theme> {
  noStore();
  try {
    const slug = tenantSlugFromPathname(headers().get("x-pathname"));
    if (slug) {
      const biz = await prisma.business.findUnique({ where: { slug }, select: { settings: true } });
      if (biz) return resolveTheme(biz.settings ?? null);
    }
    const business = await fallbackBusiness({ select: { settings: true } });
    return resolveTheme(business?.settings ?? null);
  } catch {
    return resolveTheme(null);
  }
}
