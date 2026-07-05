import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Multi-tenant resolution for PUBLIC routes.
 *
 * The app is multi-tenant at the schema level (every table has businessId) but
 * historically every public route resolved the business with findFirst(). These
 * helpers centralize the resolution order:
 *
 *   1. ?slug=<slug>        → findUnique({ where: { slug } })   (canonical, used by /<slug>)
 *   2. ?businessId=<id>    → findUnique({ where: { id } })     (internal callers)
 *   3. (neither)           → findFirst()                       (backward-compat — the
 *                            single live DOMINANT business serves the legacy root URLs)
 *
 * Keep the findFirst() fallback until DOMINANT is migrated to /<slug> (see plan M6),
 * otherwise the legacy root storefront breaks.
 */

function readParams(req: Request): { slug: string | null; businessId: string | null } {
  const { searchParams } = new URL(req.url);
  return {
    slug: searchParams.get("slug"),
    businessId: searchParams.get("businessId"),
  };
}

/**
 * The legacy/root business — the backward-compat fallback when a public request
 * carries NO ?slug= and NO ?businessId= (i.e. the bare root storefront `/`).
 *
 * ⚠️ A plain findFirst() is NON-DETERMINISTIC: Postgres returns rows in arbitrary
 * order, so with 2+ tenants the root URL would randomly serve a different shop.
 * This caused DOMINANT's root storefront to show another business's data.
 *
 * Resolution order (deterministic):
 *   1. ROOT_BUSINESS_SLUG env, if set and found  (explicit pin)
 *   2. the OLDEST business (createdAt asc)        (the original DOMINANT install)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fallbackBusiness(sel: any = {}): Promise<any> {
  const rootSlug = process.env.ROOT_BUSINESS_SLUG;
  if (rootSlug) {
    const b = await prisma.business.findUnique({ where: { slug: rootSlug }, ...sel });
    if (b) return b;
  }
  return prisma.business.findFirst({ orderBy: { createdAt: "asc" }, ...sel });
}

/**
 * The id of the ROOT/legacy business — the one served at the bare root URL (`/`).
 * Same resolution as fallbackBusiness: ROOT_BUSINESS_SLUG env, else oldest install.
 * Used to decide a business's canonical public path ("/" for root, "/<slug>" else).
 */
export async function getRootBusinessId(): Promise<string | null> {
  const rootSlug = process.env.ROOT_BUSINESS_SLUG;
  if (rootSlug) {
    const b = await prisma.business.findUnique({ where: { slug: rootSlug }, select: { id: true } });
    if (b) return b.id;
  }
  const b = await prisma.business.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  return b?.id ?? null;
}

/** Resolve only the business id (cheapest — selects id). Returns null if not found. */
export async function resolveBusinessId(req: Request): Promise<string | null> {
  const { slug, businessId } = readParams(req);
  if (slug) {
    const b = await prisma.business.findUnique({ where: { slug }, select: { id: true } });
    return b?.id ?? null;
  }
  if (businessId) {
    const b = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
    return b?.id ?? null;
  }
  const b = await fallbackBusiness({ select: { id: true } });
  return b?.id ?? null;
}

/**
 * Resolve the full business record (or a selected subset) for a public request.
 * Pass a Prisma `select` to limit fields. Returns null if not found.
 */
export async function resolveBusiness<T extends Prisma.BusinessSelect>(
  req: Request,
  select?: T,
): Promise<Prisma.BusinessGetPayload<{ select: T }> | null> {
  const { slug, businessId } = readParams(req);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sel: any = select ? { select } : {};
  if (slug) {
    return prisma.business.findUnique({ where: { slug }, ...sel }) as never;
  }
  if (businessId) {
    return prisma.business.findUnique({ where: { id: businessId }, ...sel }) as never;
  }
  return fallbackBusiness(sel) as never;
}

/**
 * Slugs that must never be assigned to a business — they collide with real
 * top-level routes/segments (Next.js prioritizes static folders over the
 * dynamic [slug] segment, so a business slugged "admin" would be unreachable
 * AND could shadow links). Any generated base that lands here gets a suffix.
 */
const RESERVED_SLUGS = new Set([
  "admin", "api", "signup", "login", "for-business", "book",
  "_next", "favicon.ico", "fonts", "static", "public", "www",
  "dashboard", "settings", "businesses", "shop",
]);

/**
 * Extract the tenant slug from a request PATHNAME (server-side mirror of the
 * client `useSlug()`), e.g. "/dani/book/time" → "dani", "/book/time" → null,
 * "/" → null. A reserved first segment (book/admin/api/…) means "root, no
 * tenant". Used by the server layout to resolve the correct theme for the very
 * first paint (the middleware forwards the visible pathname via `x-pathname`).
 */
export function tenantSlugFromPathname(pathname: string | null | undefined): string | null {
  const first = (pathname || "").split("/").filter(Boolean)[0];
  if (first && !RESERVED_SLUGS.has(first)) return first;
  return null;
}

/**
 * Turn a free-form business name into a URL-safe, unique slug.
 *
 * - lowercases, keeps [a-z0-9-], collapses repeats/edges
 * - Hebrew/non-latin names often reduce to empty → fall back to "shop"
 * - never returns a RESERVED_SLUGS value (would shadow a static route)
 * - guarantees uniqueness against the DB by appending a short base36 suffix
 *   when the base slug is taken (or empty/reserved)
 */
export async function generateSlug(name: string): Promise<string> {
  const base =
    (name || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "shop";

  // If the clean base is free AND not reserved, use it as-is.
  const existing = RESERVED_SLUGS.has(base)
    ? { id: "reserved" }
    : await prisma.business.findUnique({ where: { slug: base }, select: { id: true } });
  if (!existing) return base;

  // Otherwise append a short random suffix and retry a few times.
  for (let i = 0; i < 5; i++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${base}-${suffix}`;
    const taken = await prisma.business.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  // Extremely unlikely fallback: timestamp-based.
  return `${base}-${Date.now().toString(36)}`;
}
