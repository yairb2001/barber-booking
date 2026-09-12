import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner, getRequestSession } from "@/lib/session";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

export const dynamic = "force-dynamic";

/**
 * Duplicate customers: the same phone stored twice ("05x…" and "9725x…" —
 * one from the booking link, one typed by a barber). Each pair splits history,
 * notes and referral credit.
 *
 * GET  → list of groups { phone, customers: [{id, name, phone, visits, createdAt, notes}] }
 * POST { keepId, mergeIds[] } → re-points every appointment / waitlist /
 *      recurring rule / conversation / referral to keepId, merges notes, and
 *      soft-deletes the others (phone suffixed so the unique index stays happy).
 */
export async function GET(req: NextRequest) {
  const denied = requireOwner(req);
  if (denied) return denied;
  const session = getRequestSession(req)!;

  const rows = await prisma.customer.findMany({
    where: { businessId: session.businessId, deletedAt: null },
    select: { id: true, name: true, phone: true, createdAt: true, notes: true, _count: { select: { appointments: true } } },
  });
  const byNorm = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = normalizeIsraeliPhone(r.phone);
    if (!key || key.length < 11) continue;
    byNorm.set(key, [...(byNorm.get(key) || []), r]);
  }
  const groups = Array.from(byNorm.entries())
    .filter(([, list]) => list.length > 1)
    .map(([phone, list]) => ({
      phone,
      customers: list
        .map(c => ({ id: c.id, name: c.name, phone: c.phone, createdAt: c.createdAt, notes: c.notes, visits: c._count.appointments }))
        .sort((a, b) => b.visits - a.visits || a.createdAt.getTime() - b.createdAt.getTime()),
    }));
  return NextResponse.json(groups);
}

export async function POST(req: NextRequest) {
  const denied = requireOwner(req);
  if (denied) return denied;
  const session = getRequestSession(req)!;
  const body = await req.json().catch(() => ({}));
  const keepId: string = body.keepId;
  const mergeIds: string[] = Array.isArray(body.mergeIds) ? body.mergeIds.filter((x: unknown) => typeof x === "string" && x !== keepId) : [];
  if (!keepId || !mergeIds.length) return NextResponse.json({ error: "keepId + mergeIds required" }, { status: 400 });

  const all = await prisma.customer.findMany({ where: { id: { in: [keepId, ...mergeIds] }, businessId: session.businessId } });
  const keep = all.find(c => c.id === keepId);
  if (!keep || all.length !== mergeIds.length + 1) return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
  const others = all.filter(c => c.id !== keepId);

  await prisma.$transaction(async tx => {
    for (const o of others) {
      await tx.appointment.updateMany({ where: { customerId: o.id }, data: { customerId: keepId } });
      await tx.waitlist.updateMany({ where: { customerId: o.id }, data: { customerId: keepId } });
      await tx.recurringAppointment.updateMany({ where: { customerId: o.id }, data: { customerId: keepId } });
      await tx.conversation.updateMany({ where: { customerId: o.id }, data: { customerId: keepId } });
      await tx.customer.updateMany({ where: { referredById: o.id }, data: { referredById: keepId } });
      // Per-barber blocks: keep the union (skip rows that would collide).
      const blocks = await tx.customerStaffBlock.findMany({ where: { customerId: o.id } });
      for (const b of blocks) {
        await tx.customerStaffBlock.upsert({
          where: { customerId_staffId: { customerId: keepId, staffId: b.staffId } },
          create: { customerId: keepId, staffId: b.staffId },
          update: {},
        });
      }
      await tx.customerStaffBlock.deleteMany({ where: { customerId: o.id } });
      // Retire the duplicate: soft-delete + free the phone for the unique index.
      await tx.customer.update({ where: { id: o.id }, data: { deletedAt: new Date(), phone: `${o.phone}#merged-${o.id.slice(0, 8)}` } });
    }
    const mergedNotes = [keep.notes, ...others.map(o => o.notes)].filter(n => n && n.trim()).join("\n");
    const earliest = [keep, ...others].map(c => c.createdAt.getTime()).sort()[0];
    const lastVisit = [keep, ...others].map(c => c.lastVisitAt?.getTime() || 0).sort((a, b) => b - a)[0];
    await tx.customer.update({
      where: { id: keepId },
      data: {
        phone: normalizeIsraeliPhone(keep.phone) || keep.phone,
        notes: mergedNotes || keep.notes,
        referralSource: keep.referralSource || others.find(o => o.referralSource)?.referralSource || null,
        referredById: keep.referredById || others.find(o => o.referredById)?.referredById || null,
        createdAt: new Date(earliest),
        ...(lastVisit ? { lastVisitAt: new Date(lastVisit) } : {}),
      },
    });
  });
  return NextResponse.json({ ok: true, merged: others.length });
}
