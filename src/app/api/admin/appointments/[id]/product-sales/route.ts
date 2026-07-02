import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getEffectivePermissions } from "@/lib/session";

// Product sales attached to a single appointment. A barber can log/read sales
// for their OWN appointments; owners (and sub-managers with "view all
// calendars") can act on any appointment in their business. These records are
// intentionally SEPARATE from appointment revenue — they never touch turnover.

// Load the appointment, enforce tenant isolation + per-barber scoping.
// Returns { appt } on success or { res } holding the error response.
async function guard(req: NextRequest, id: string) {
  const session = getRequestSession(req);
  if (!session) return { res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const appt = await prisma.appointment.findUnique({
    where: { id },
    select: { id: true, businessId: true, staffId: true, customerId: true },
  });
  if (!appt) return { res: NextResponse.json({ error: "not found" }, { status: 404 }) };
  if (appt.businessId !== session.businessId) {
    return { res: NextResponse.json({ error: "אין הרשאה לתור זה" }, { status: 403 }) };
  }
  if (!session.isOwner && session.staffId && appt.staffId !== session.staffId) {
    const perms = await getEffectivePermissions(req);
    if (!perms.canViewAllCalendars) {
      return { res: NextResponse.json({ error: "אין הרשאה לתור זה" }, { status: 403 }) };
    }
  }
  return { appt };
}

// GET — the appointment's current sales + the product catalog for the picker.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(req, params.id);
  if (g.res) return g.res;
  const appt = g.appt!;

  const [sales, products] = await Promise.all([
    prisma.productSale.findMany({
      where: { appointmentId: appt.id },
      select: {
        productId: true,
        quantity: true,
        unitPrice: true,
        product: { select: { name: true } },
      },
    }),
    prisma.product.findMany({
      where: { businessId: appt.businessId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, price: true },
    }),
  ]);

  return NextResponse.json({
    sales: sales.map(s => ({
      productId: s.productId,
      name: s.product.name,
      quantity: s.quantity,
      unitPrice: s.unitPrice,
    })),
    products,
  });
}

// PUT — replace the appointment's product sales with the provided set.
// Body: { items: [{ productId: string, quantity?: number }] }
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(req, params.id);
  if (g.res) return g.res;
  const appt = g.appt!;

  const body = await req.json().catch(() => ({}));
  const rawItems: unknown[] = Array.isArray(body?.items) ? body.items : [];

  // Normalize + dedupe by productId (last wins), drop qty <= 0.
  const wanted = new Map<string, number>();
  for (const it of rawItems) {
    if (!it || typeof it !== "object") continue;
    const pid = (it as { productId?: unknown }).productId;
    const qty = Math.max(1, Math.floor(Number((it as { quantity?: unknown }).quantity) || 1));
    if (typeof pid === "string" && pid) wanted.set(pid, qty);
  }

  // Validate the products belong to this business + snapshot their price.
  const prods = wanted.size
    ? await prisma.product.findMany({
        where: { businessId: appt.businessId, id: { in: Array.from(wanted.keys()) } },
        select: { id: true, price: true },
      })
    : [];
  const priceById = new Map(prods.map(p => [p.id, p.price]));

  // Replace-set: wipe existing then recreate. Cheap (a handful of rows) and
  // keeps the @@unique([appointmentId, productId]) invariant clean.
  await prisma.$transaction([
    prisma.productSale.deleteMany({ where: { appointmentId: appt.id } }),
    ...Array.from(wanted.entries())
      .filter(([pid]) => priceById.has(pid))
      .map(([pid, qty]) =>
        prisma.productSale.create({
          data: {
            businessId: appt.businessId,
            appointmentId: appt.id,
            productId: pid,
            staffId: appt.staffId,
            customerId: appt.customerId,
            quantity: qty,
            unitPrice: priceById.get(pid) ?? 0,
          },
        }),
      ),
  ]);

  return NextResponse.json({ ok: true, count: priceById.size });
}
