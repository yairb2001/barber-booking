import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin, SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";

/**
 * PATCH /api/admin/super/businesses/[id]
 * Platform-owner actions on a single tenant. Accepts any subset of:
 *   monthlyPrice, setupFee, tier   → set billing
 *   extendTrialDays: number        → push trialEndsAt forward N days from now
 *   markPaid: boolean              → set/clear paidAt (converts trial → paying)
 *   suspend: boolean               → set/clear suspendedAt
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (typeof body.monthlyPrice === "number") data.monthlyPrice = Math.max(0, Math.round(body.monthlyPrice));
  if (body.monthlyPrice === null) data.monthlyPrice = null;
  if (typeof body.setupFee === "number") data.setupFee = Math.max(0, Math.round(body.setupFee));
  if (body.setupFee === null) data.setupFee = null;
  if (typeof body.tier === "string" && ["basic", "pro", "premium"].includes(body.tier)) data.tier = body.tier;

  if (typeof body.extendTrialDays === "number" && body.extendTrialDays > 0) {
    data.trialEndsAt = new Date(Date.now() + body.extendTrialDays * 86400000);
  }
  if (typeof body.markPaid === "boolean") data.paidAt = body.markPaid ? new Date() : null;
  if (typeof body.suspend === "boolean") data.suspendedAt = body.suspend ? new Date() : null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "no valid fields" }, { status: 400 });
  }

  const updated = await prisma.business.update({
    where: { id: params.id },
    data,
    select: { id: true, monthlyPrice: true, setupFee: true, tier: true, paidAt: true, suspendedAt: true, trialEndsAt: true },
  });
  return NextResponse.json({ ok: true, business: updated });
}

/**
 * DELETE /api/admin/super/businesses/[id]
 * Hard-delete a tenant. Guarded: never the platform's own business, and only
 * EMPTY shells (no staff / customers / appointments) — abandoned signups.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = params.id;
  if (id === SUPER_ADMIN_BUSINESS_ID) {
    return NextResponse.json({ error: "אי אפשר למחוק את עסק הפלטפורמה" }, { status: 400 });
  }

  const [staff, customers, appts] = await Promise.all([
    prisma.staff.count({ where: { businessId: id } }),
    prisma.customer.count({ where: { businessId: id } }),
    prisma.appointment.count({ where: { businessId: id } }),
  ]);
  if (staff > 0 || customers > 0 || appts > 0) {
    return NextResponse.json(
      { error: "מחיקה מותרת רק לעסק ריק (בלי ספרים/לקוחות/תורים). השהה אותו במקום." },
      { status: 400 },
    );
  }

  await prisma.$transaction([
    prisma.conversationMessage.deleteMany({ where: { conversation: { businessId: id } } }),
    prisma.conversation.deleteMany({ where: { businessId: id } }),
    prisma.messageLog.deleteMany({ where: { businessId: id } }),
    prisma.automation.deleteMany({ where: { businessId: id } }),
    prisma.story.deleteMany({ where: { businessId: id } }),
    prisma.announcement.deleteMany({ where: { businessId: id } }),
    prisma.product.deleteMany({ where: { businessId: id } }),
    prisma.service.deleteMany({ where: { businessId: id } }),
    prisma.waitlist.deleteMany({ where: { businessId: id } }),
    prisma.agentConfig.deleteMany({ where: { businessId: id } }),
    prisma.business.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true });
}
