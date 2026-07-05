"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * Top-level URL segments that are REAL routes, not tenant slugs. When a public
 * page's first path segment is one of these, there is no tenant → slug is null
 * (legacy DOMINANT root behavior). Keeps `/book/*` (the root storefront) from
 * being misread as a shop slug. Mirrors RESERVED_SLUGS in src/lib/tenant.ts.
 */
const ROOT_SEGMENTS = new Set([
  "book", "admin", "api", "signup", "login", "for-business",
  "fonts", "_next", "favicon.ico", "static", "public",
]);

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
  const pathname = usePathname();

  // 1. Normal case: the page lives under the [slug] filesystem route, so Next
  //    gives us the slug as a route param.
  const s = params?.slug;
  if (typeof s === "string" && s.length > 0) return s;

  // 2. Fallback-rewrite case: /<slug>/book/* was served by the root /book/*
  //    pages (see next.config.mjs `fallback` rewrite), so there is NO [slug]
  //    param. Recover the slug from the FIRST segment of the visible browser URL
  //    (rewrites preserve the URL). A reserved first segment (e.g. "book" on the
  //    legacy root /book/*) means "no tenant" → null, exactly as before.
  const first = (pathname || "").split("/").filter(Boolean)[0];
  if (first && !ROOT_SEGMENTS.has(first)) return first;

  return null;
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
