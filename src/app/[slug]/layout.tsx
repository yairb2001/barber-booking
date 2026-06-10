import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

/**
 * Tenant guard for the public `/<slug>` storefront subtree.
 *
 * Static top-level folders (admin, api, signup, for-business, book, _next, …)
 * win over this dynamic `[slug]` segment in Next.js routing, so only genuine
 * "shop slug" URLs reach here. If the slug doesn't map to a business we 404 —
 * which also protects /<slug>/book/... since the layout wraps the whole subtree.
 *
 * The actual pages are thin re-exports of the legacy root storefront components
 * (src/app/page.tsx, src/app/book/*). Those components read the slug via
 * useSlug() and thread it through every fetch/link, so the same code serves both
 * the legacy DOMINANT root (no slug) and any number of slugged tenants.
 */
export default async function SlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  const biz = await prisma.business.findUnique({
    where: { slug: params.slug },
    select: { id: true },
  });
  if (!biz) notFound();
  return <>{children}</>;
}
