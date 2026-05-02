import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { requireOwner } from "@/lib/session";

const DEFAULT_PASSWORD = "12345678";

// POST /api/admin/staff/from-customer — convert an existing customer to a staff member
export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const { customerId } = await req.json();
  if (!customerId) return NextResponse.json({ error: "customerId required" }, { status: 400 });

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });

  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  // Check if phone already used by a staff member
  if (customer.phone) {
    const existing = await prisma.staff.findFirst({
      where: { businessId: business.id, phone: customer.phone },
    });
    if (existing) {
      return NextResponse.json(
        { error: `מספר הטלפון ${customer.phone} כבר שייך לספר קיים (${existing.name})` },
        { status: 409 }
      );
    }
  }

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);

  const staff = await prisma.staff.create({
    data: {
      businessId: business.id,
      name: customer.name,
      phone: customer.phone,
      role: "barber",
      isAvailable: true,
      inQuickPool: false,
      sortOrder: 0,
      passwordHash,
    },
  });

  return NextResponse.json({ ok: true, staffId: staff.id, defaultPassword: DEFAULT_PASSWORD }, { status: 201 });
}
