import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

// ── GET — rule + upcoming generated appointments ────────────────────────────
export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const rule = await prisma.recurringAppointment.findUnique({
    where: { id: ctx.params.id },
    include: {
      customer: true,
      staff: true,
      service: true,
      appointments: { orderBy: [{ date: "asc" }, { startTime: "asc" }] },
    },
  });
  if (!rule) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Staff scoping: barbers can only view their own rules
  const session = getRequestSession(req);
  if (session && !session.isOwner && session.staffId && rule.staffId !== session.staffId) {
    return NextResponse.json({ error: "אין הרשאה לכלל זה" }, { status: 403 });
  }

  return NextResponse.json(rule);
}

// ── DELETE — cancel the rule + (optionally) its future occurrences ──────────
// Query:
//   ?future=true  (default)  → cancels all future appointments from today forward
//   ?future=all              → also cancels past/upcoming appointments
export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("future") || "future"; // "future" | "all"

  const rule = await prisma.recurringAppointment.findUnique({ where: { id: ctx.params.id } });
  if (!rule) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Staff scoping: barbers can only delete their own rules
  const session = getRequestSession(req);
  if (session && !session.isOwner && session.staffId && rule.staffId !== session.staffId) {
    return NextResponse.json({ error: "אין הרשאה לכלל זה" }, { status: 403 });
  }

  const today = new Date();
  const todayUTC = new Date(today.toISOString().split("T")[0] + "T00:00:00.000Z");

  // Cancel related appointments
  const where: Record<string, unknown> = {
    recurringId: rule.id,
    status: { in: ["pending", "confirmed"] },
  };
  if (mode === "future") where.date = { gte: todayUTC };

  const { count } = await prisma.appointment.updateMany({
    where,
    data: { status: "cancelled_by_staff", cancelledAt: new Date() },
  });

  // Mark rule inactive (keeps history, prevents future auto-generation)
  await prisma.recurringAppointment.update({
    where: { id: rule.id },
    data: { active: false },
  });

  return NextResponse.json({ ok: true, cancelled: count });
}
