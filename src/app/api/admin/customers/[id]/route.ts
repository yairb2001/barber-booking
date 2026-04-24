import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.phone === "string" && body.phone.trim()) data.phone = body.phone.replace(/\s/g, "");
  if (typeof body.isBlocked === "boolean") data.isBlocked = body.isBlocked;
  if (body.referralSource !== undefined) data.referralSource = body.referralSource || null;
  if (body.notes !== undefined) {
    data.notificationPrefs = body.notes ? JSON.stringify({ notes: String(body.notes) }) : null;
  }

  const customer = await prisma.customer.update({ where: { id }, data });
  return NextResponse.json(customer);
}

// DELETE — hard delete customer (blocks if there are appointments)
export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  const { id } = ctx.params;

  const apptCount = await prisma.appointment.count({ where: { customerId: id } });
  if (apptCount > 0) {
    return NextResponse.json(
      { error: `לא ניתן למחוק - ללקוח יש ${apptCount} תורים בהיסטוריה. אפשר לחסום אותו במקום.` },
      { status: 400 }
    );
  }

  // Also clear waitlist entries
  await prisma.waitlist.deleteMany({ where: { customerId: id } });
  await prisma.customer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
