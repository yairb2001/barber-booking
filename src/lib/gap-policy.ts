import { prisma } from "@/lib/prisma";

/**
 * The "auto" minimum gap = the business's shortest visible service (owner,
 * 16.10.2026: a gap shorter than any service sells to no one). Stored in
 * Business.settings.gapPolicy.autoMin so gridOf stays synchronous; refreshed
 * whenever a service is created, changed or deleted.
 */
export async function refreshGapAutoMin(businessId: string): Promise<void> {
  const svc = await prisma.service.findMany({
    where: { businessId, isVisible: true, NOT: { name: "שירות זמני" } },
    select: { durationMinutes: true },
  });
  const min = svc.map(s => s.durationMinutes).filter(m => m > 0).reduce((a, b) => Math.min(a, b), Infinity);
  if (!Number.isFinite(min)) return;
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { settings: true } });
  let s: Record<string, unknown> = {};
  try { s = biz?.settings ? JSON.parse(biz.settings) : {}; } catch { s = {}; }
  const gp = (s.gapPolicy && typeof s.gapPolicy === "object" ? s.gapPolicy : {}) as Record<string, unknown>;
  if (gp.autoMin === min) return;
  await prisma.business.update({ where: { id: businessId }, data: { settings: JSON.stringify({ ...s, gapPolicy: { ...gp, autoMin: min } }) } });
}
