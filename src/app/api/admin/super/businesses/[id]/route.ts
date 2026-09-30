import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin, SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { isBusinessType } from "@/lib/vocab";
import { ensureEvolutionInstance, deleteEvolutionInstance } from "@/lib/messaging/evolution";

/**
 * PATCH /api/admin/super/businesses/[id]
 * Platform-owner actions on a single tenant. Accepts any subset of:
 *   monthlyPrice, setupFee, tier   → set billing
 *   businessType                   → the vertical (barber_men | barber_women | nails | cosmetics)
 *   tokenBudgetIls: number | null  → the monthly token package as raw cost in ₪ (null = tier default)
 *   tokenTopupIls: number          → one-time addition to THIS month's package
 *   greenApiInstanceId, greenApiToken, whatsappStatus → the number connection (stage 1 "חיבורים ממתינים")
 *   messagingProvider: "evolution" | "green_api" → "evolution" creates the instance on our server (named after the slug)
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
  if (isBusinessType(body.businessType)) data.businessType = body.businessType;
  if (typeof body.greenApiInstanceId === "string") data.greenApiInstanceId = body.greenApiInstanceId.trim() || null;
  if (typeof body.greenApiToken === "string") data.greenApiToken = body.greenApiToken.trim() || null;
  if (typeof body.whatsappStatus === "string" && ["not_requested", "requested", "connected"].includes(body.whatsappStatus)) data.whatsappStatus = body.whatsappStatus;
  if (body.messagingProvider === "evolution" || body.messagingProvider === "green_api") {
    const biz = await prisma.business.findUnique({ where: { id: params.id }, select: { slug: true, evolutionInstance: true } });
    if (!biz) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (body.messagingProvider === "evolution") {
      const name = biz.evolutionInstance || biz.slug;
      const r = await ensureEvolutionInstance(name);
      if (!r.ok) return NextResponse.json({ error: `יצירת המופע בשרת נכשלה: ${r.error}` }, { status: 502 });
      data.evolutionInstance = name;
      data.messagingProvider = "evolution";
      data.whatsappStatus = "requested";
      data.waLiveState = "notAuthorized";
    } else {
      data.messagingProvider = "green_api";
      if (body.dropEvolutionInstance === true && biz.evolutionInstance) { await deleteEvolutionInstance(biz.evolutionInstance).catch(() => null); data.evolutionInstance = null; }
    }
  }

  // Token package lives in settings JSON (merge, never overwrite other keys).
  if (body.tokenBudgetIls === null || typeof body.tokenBudgetIls === "number" || typeof body.tokenTopupIls === "number") {
    const cur = await prisma.business.findUnique({ where: { id: params.id }, select: { settings: true } });
    let s: Record<string, unknown> = {};
    try { s = cur?.settings ? JSON.parse(cur.settings) : {}; } catch { s = {}; }
    if (body.tokenBudgetIls === null) delete s.tokenBudgetIls;
    else if (typeof body.tokenBudgetIls === "number") s.tokenBudgetIls = Math.max(0, Math.round(body.tokenBudgetIls));
    if (typeof body.tokenTopupIls === "number" && body.tokenTopupIls !== 0) {
      const { currentMonth } = await import("@/lib/agent/token-budget");
      const topups = Array.isArray(s.tokenTopups) ? (s.tokenTopups as unknown[]) : [];
      topups.push({ month: currentMonth().key, ils: Math.round(body.tokenTopupIls), at: new Date().toISOString() });
      s.tokenTopups = topups;
    }
    data.settings = JSON.stringify(s);
  }

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
    select: { id: true, monthlyPrice: true, setupFee: true, tier: true, businessType: true, paidAt: true, suspendedAt: true, trialEndsAt: true, messagingProvider: true, evolutionInstance: true, whatsappStatus: true },
  });
  return NextResponse.json({ ok: true, business: updated });
}

/**
 * DELETE /api/admin/super/businesses/[id]
 * Hard-delete a tenant. Guarded: never the platform's own business, and only
 * businesses with NO real activity — no customers and no appointments. (Staff
 * count isn't the emptiness signal: onboarding creates a barber + service
 * before any bookings, so real usage means customers or booked tourim.)
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSuperAdmin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = params.id;
  if (id === SUPER_ADMIN_BUSINESS_ID) {
    return NextResponse.json({ error: "אי אפשר למחוק את עסק הפלטפורמה" }, { status: 400 });
  }

  const [customers, appts] = await Promise.all([
    prisma.customer.count({ where: { businessId: id } }),
    prisma.appointment.count({ where: { businessId: id } }),
  ]);
  if (customers > 0 || appts > 0) {
    return NextResponse.json(
      { error: "מחיקה מותרת רק לעסק בלי לקוחות/תורים. השהה אותו במקום." },
      { status: 400 },
    );
  }

  // Delete children before parents to satisfy FK constraints. Tables that depend
  // on a customer or an appointment are empty here (guarded above), so we only
  // need to clear staff/service scaffolding + content + conversations.
  await prisma.$transaction([
    prisma.conversationMessage.deleteMany({ where: { conversation: { businessId: id } } }),
    prisma.conversation.deleteMany({ where: { businessId: id } }),
    prisma.agentFAQ.deleteMany({ where: { agentConfig: { businessId: id } } }),
    prisma.agentConfig.deleteMany({ where: { businessId: id } }),
    prisma.messageLog.deleteMany({ where: { businessId: id } }),
    prisma.automation.deleteMany({ where: { businessId: id } }),
    prisma.otpCode.deleteMany({ where: { businessId: id } }),
    prisma.staffService.deleteMany({ where: { staff: { businessId: id } } }),
    prisma.staffSchedule.deleteMany({ where: { staff: { businessId: id } } }),
    prisma.staffScheduleOverride.deleteMany({ where: { staff: { businessId: id } } }),
    prisma.portfolioItem.deleteMany({ where: { staff: { businessId: id } } }),
    prisma.waitlist.deleteMany({ where: { businessId: id } }),
    prisma.story.deleteMany({ where: { businessId: id } }),
    prisma.announcement.deleteMany({ where: { businessId: id } }),
    prisma.product.deleteMany({ where: { businessId: id } }),
    prisma.service.deleteMany({ where: { businessId: id } }),
    prisma.staff.deleteMany({ where: { businessId: id } }),
    prisma.business.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true });
}
