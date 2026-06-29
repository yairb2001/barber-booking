import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

// GET — full customer record + upcoming appointments + past appointments summary
export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const { id } = ctx.params;
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      appointments: {
        orderBy: [{ date: "desc" }, { startTime: "desc" }],
        include: { staff: true, service: true },
      },
      // Customers this person referred
      referrals: {
        select: { id: true, name: true, phone: true, createdAt: true, appointments: { where: { status: "completed" }, select: { id: true } } },
      },
    },
  });
  if (!customer) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Tenant isolation: never expose a customer from another business.
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (customer.businessId !== session.businessId) {
    return NextResponse.json({ error: "אין הרשאה ללקוח זה" }, { status: 403 });
  }

  // Staff scoping: barbers can only view customers they've served
  if (session && !session.isOwner && session.staffId) {
    const hasAppt = await prisma.appointment.count({
      where: { customerId: id, staffId: session.staffId },
    });
    if (hasAppt === 0) {
      return NextResponse.json({ error: "אין הרשאה ללקוח זה" }, { status: 403 });
    }
  }

  const now = new Date();
  const todayUTC = new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const upcoming = customer.appointments.filter(
    a => a.date >= todayUTC && ["pending", "confirmed"].includes(a.status)
  );
  const past = customer.appointments.filter(
    a => a.date < todayUTC || a.status === "completed" || a.status.startsWith("cancelled")
  );

  // Count referrals that have actually made at least one completed appointment
  const confirmedReferrals = customer.referrals.filter(r => r.appointments.length > 0).length;

  // Rewards: 2 confirmed referrals = product gift, 3 = free haircut
  const rewards = {
    confirmedReferrals,
    totalReferrals: customer.referrals.length,
    productGiftEarned: confirmedReferrals >= 2,
    freeHaircutEarned: confirmedReferrals >= 3,
    nextMilestone: confirmedReferrals < 2 ? { target: 2, reward: "מוצר במתנה 🎁", remaining: 2 - confirmedReferrals }
      : confirmedReferrals < 3 ? { target: 3, reward: "תספורת חינם ✂️", remaining: 3 - confirmedReferrals }
      : null,
  };

  return NextResponse.json({
    ...customer,
    appointments: undefined,
    referrals: customer.referrals.map(r => ({ ...r, appointments: undefined, completedVisits: r.appointments.length })),
    upcoming,
    past,
    totalVisits: past.filter(a => a.status === "completed").length,
    rewards,
  });
}

// PATCH — edit name, toggle block, update notes/referral
export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const { id } = ctx.params;

  // Tenant isolation: verify the customer belongs to the caller's business.
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const target = await prisma.customer.findUnique({ where: { id }, select: { businessId: true } });
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (target.businessId !== session.businessId) {
    return NextResponse.json({ error: "אין הרשאה ללקוח זה" }, { status: 403 });
  }

  // Staff scoping: barbers can only edit customers they've served
  if (session && !session.isOwner && session.staffId) {
    const hasAppt = await prisma.appointment.count({
      where: { customerId: id, staffId: session.staffId },
    });
    if (hasAppt === 0) {
      return NextResponse.json({ error: "אין הרשאה ללקוח זה" }, { status: 403 });
    }
  }

  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.phone === "string" && body.phone.trim()) data.phone = normalizeIsraeliPhone(body.phone) || body.phone.replace(/\s/g, "");
  if (typeof body.isBlocked === "boolean") data.isBlocked = body.isBlocked;
  if (body.referralSource !== undefined) data.referralSource = body.referralSource || null;
  if (body.notes !== undefined) {
    data.notificationPrefs = body.notes ? JSON.stringify({ notes: String(body.notes) }) : null;
  }

  const customer = await prisma.customer.update({ where: { id }, data });
  return NextResponse.json(customer);
}

// DELETE — remove customer from the system while preserving appointment history.
// If the customer has no appointments we hard-delete; otherwise we soft-delete
// (mark deletedAt) so the past appointments keep their customer name via relation.
export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const { id } = ctx.params;

  // Tenant isolation: never delete a customer from another business.
  const session = getRequestSession(req)!;
  const target = await prisma.customer.findUnique({ where: { id }, select: { businessId: true } });
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (target.businessId !== session.businessId) {
    return NextResponse.json({ error: "אין הרשאה ללקוח זה" }, { status: 403 });
  }

  // Detach anything that would block a clean removal / keep them resurfacing.
  // Other customers who were referred by this person → clear the link.
  await prisma.customer.updateMany({ where: { referredById: id }, data: { referredById: null } });
  // Drop waitlist entries and deactivate any recurring appointments.
  await prisma.waitlist.deleteMany({ where: { customerId: id } });
  await prisma.recurringAppointment.updateMany({ where: { customerId: id }, data: { active: false } });

  const apptCount = await prisma.appointment.count({ where: { customerId: id } });
  if (apptCount > 0) {
    // History exists — soft delete. The customer disappears from every list but
    // the appointments (and their customer name) stay intact.
    await prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date(), isBlocked: true },
    });
    return NextResponse.json({ ok: true, soft: true });
  }

  // No history — safe to hard delete.
  await prisma.customer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
