import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyPlatformOwner } from "@/lib/super-admin";

/**
 * PUBLIC lead capture — the /for-business landing page posts here.
 *
 * Lives outside /api/admin so the auth middleware doesn't guard it. Records the
 * prospect and fires a WhatsApp alert to the platform owner so no lead is lost.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";

  if (!phone || phone.replace(/\D/g, "").length < 9) {
    return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
  }

  const lead = await prisma.lead.create({
    data: {
      name: name || null,
      phone,
      source: "landing",
      status: "new",
    },
    select: { id: true },
  });

  await notifyPlatformOwner(
    `🔥 ליד חדש מהאתר\nשם: ${name || "—"}\nטלפון: ${phone}\nהיכנס לניהול → לידים כדי להרים שיחה.`,
  );

  return NextResponse.json({ ok: true, id: lead.id });
}
