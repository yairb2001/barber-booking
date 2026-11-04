import { Suspense } from "react";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { fallbackBusiness } from "@/lib/tenant";
import WorksGallery from "./WorksGallery";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.dominantbarber.com";

/** In WhatsApp the link shows as a card: the treatment, the shop and one of its works. */
export async function generateMetadata({ params, searchParams }: { params: { slug?: string }; searchParams: { s?: string } }): Promise<Metadata> {
  const biz: { id: string; name: string } | null = params.slug
    ? await prisma.business.findUnique({ where: { slug: params.slug }, select: { id: true, name: true } })
    : await fallbackBusiness({ select: { id: true, name: true } });
  if (!biz) return {};
  const s = typeof searchParams.s === "string" && searchParams.s.length >= 4 ? searchParams.s : "";
  const service = s ? await prisma.service.findFirst({ where: { businessId: biz.id, id: { startsWith: s } }, select: { id: true, name: true } }) : null;
  const works = await prisma.story.findMany({
    where: { businessId: biz.id, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], ...(service && { serviceId: service.id }) },
    orderBy: { sortOrder: "asc" },
    select: { mediaUrl: true },
  });
  const title = service ? `${service.name} · ${biz.name}` : `העבודות שלנו · ${biz.name}`;
  const description = `${works.length} עבודות`;
  const image = works[0]?.mediaUrl;
  return { title, description, openGraph: { title, description, images: image ? [image.startsWith("http") ? image : APP_URL + image] : [] } };
}

export default function WorksPage() {
  return <Suspense><WorksGallery /></Suspense>;
}
