"use client";

import { useParams } from "next/navigation";

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
