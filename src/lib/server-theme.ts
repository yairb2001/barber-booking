import { prisma } from "@/lib/prisma";
import { resolveTheme, type Theme } from "@/lib/themes";

/**
 * Resolve the active business theme on the SERVER so the very first paint
 * already carries the correct palette. Without this, client pages default to
 * THEMES.onyx (gold) until a client-side fetch resolves the real theme —
 * causing a visible "flash" of the wrong theme on every load / refresh.
 *
 * Mirrors exactly what /api/business does (`resolveTheme(settings)`), so the
 * later client fetch returns an identical theme and nothing visibly swaps.
 */
export async function getServerTheme(): Promise<Theme> {
  try {
    const business = await prisma.business.findFirst({ select: { settings: true } });
    return resolveTheme(business?.settings ?? null);
  } catch {
    return resolveTheme(null);
  }
}
