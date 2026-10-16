import { unstable_noStore as noStore } from "next/cache";
import { headers, cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { resolveTheme, previewTheme, THEME_PREVIEW_COOKIE, type Theme } from "@/lib/themes";
import { fallbackBusiness, tenantSlugFromPathname } from "@/lib/tenant";
import { bookingOrderOf, type BookingOrder } from "@/lib/vocab";

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
/** The current tenant's type, word overrides and booking order — same
 *  resolution as the theme: slug from the pathname, else the fallback/root
 *  business. Only these go to the browser, never the raw settings. */
export async function getServerBusinessProfile(): Promise<{ type: string | null; vocab: Record<string, string> | null; order: BookingOrder }> {
  noStore();
  const out = (b: { businessType: string; settings: string | null } | null) => {
    let vocab: Record<string, string> | null = null;
    try { const s = b?.settings ? JSON.parse(b.settings) as { vocab?: unknown } : {}; if (s.vocab && typeof s.vocab === "object") vocab = s.vocab as Record<string, string>; } catch { /* none */ }
    return { type: b?.businessType ?? null, vocab, order: bookingOrderOf(b) };
  };
  try {
    const slug = tenantSlugFromPathname(headers().get("x-pathname"));
    if (slug) {
      const biz = await prisma.business.findUnique({ where: { slug }, select: { businessType: true, settings: true } });
      if (biz) return out(biz);
    }
    return out(await fallbackBusiness({ select: { businessType: true, settings: true } }));
  } catch {
    return { type: null, vocab: null, order: "staff" };
  }
}

export async function getServerTheme(): Promise<Theme> {
  noStore();
  const preview = previewTheme(cookies().get(THEME_PREVIEW_COOKIE)?.value);
  if (preview) return preview;
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
