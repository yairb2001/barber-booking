"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * Client-side multi-tenant navigation helpers for the PUBLIC storefront.
 *
 * New businesses are served under `/<slug>` and `/<slug>/book/...` (the
 * `src/app/[slug]/...` route group). The legacy DOMINANT storefront keeps
 * living at the bare root (`/`, `/book/...`) with NO slug — every helper here
 * is a no-op when `slug` is null, so the root pages behave exactly as before.
 */

/** Read the tenant slug from the active route ([slug] segment). null = legacy root. */
export function useSlug(): string | null {
  const params = useParams();
  const s = params?.slug;
  return typeof s === "string" && s.length > 0 ? s : null;
}

/**
 * Append the tenant slug to a PUBLIC API URL as a query param.
 * No-op when slug is null (DOMINANT root → API falls back to findFirst).
 */
export function apiWithSlug(url: string, slug: string | null): string {
  if (!slug) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}slug=${encodeURIComponent(slug)}`;
}

/**
 * Build an in-app public href, prefixing the `/<slug>` segment when present.
 * `publicHref(null, "/book")` → "/book"  (DOMINANT root)
 * `publicHref("dani", "/book")` → "/dani/book"
 * `publicHref("dani", "/")` → "/dani"
 */
export function publicHref(slug: string | null, path: string): string {
  if (!slug) return path;
  if (path === "/" || path === "") return `/${slug}`;
  return `/${slug}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * "Back" that DETERMINISTICALLY returns the user to the canonical previous
 * screen for the current page.
 *
 * We deliberately do NOT use `router.back()` / `window.history.state.idx`.
 * The booking flow is entered at many points via shortcuts (home quick-slots,
 * team-upcoming, the "all upcoming" lists, …) that jump several screens ahead,
 * and the browser history is unreliable on mobile Safari / PWA (idx is often
 * stale or non-zero even for a shortcut jump). Relying on it made "back" walk
 * the user through every funnel screen they never visited, or overshoot to the
 * start. Since every caller already passes the correct canonical-previous href
 * as `fallbackHref` (confirm maps it per entry-origin via the `from` param),
 * we always navigate straight there — one screen up, every time.
 *
 * Returns an onClick handler; keep the `href` on the element too so
 * middle-click / SEO / no-JS still work.
 */
export function useSmartBack(fallbackHref: string) {
  const router = useRouter();
  return useCallback(
    (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      router.push(fallbackHref);
    },
    [router, fallbackHref]
  );
}
