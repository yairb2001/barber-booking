"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

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
 * "Back" that returns the user to the screen they actually came from.
 *
 * The booking flow can be entered at many points via shortcuts (quick slots on
 * the home page, team-upcoming, etc.), so a hard-coded back link would walk the
 * user through screens they never visited. Instead we use the browser history:
 * when there is in-app history (Next.js tracks the position in
 * `window.history.state.idx`), `router.back()` lands on the real previous
 * screen. For a cold deep-link (no history — e.g. opened straight from a
 * WhatsApp link) we fall back to the canonical href so back is never a no-op.
 *
 * Returns an onClick handler; keep the `href` on the element too so
 * middle-click / SEO / no-JS still work.
 */
export function useSmartBack(fallbackHref: string) {
  const router = useRouter();
  const canGoBack = useRef(false);
  useEffect(() => {
    try {
      const idx = (window.history.state?.idx ?? 0) as number;
      canGoBack.current = idx > 0;
    } catch {
      canGoBack.current = false;
    }
  }, []);
  return useCallback(
    (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      if (canGoBack.current) router.back();
      else router.push(fallbackHref);
    },
    [router, fallbackHref]
  );
}
