import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { requireOwner } from "@/lib/session";

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const { phone, text } = await req.json();
  if (!phone) {
    return NextResponse.json({ error: "missing phone" }, { status: 400 });
  }

  const business = await prisma.business.findFirst();
  if (!business) {
    return NextResponse.json({ error: "no business" }, { status: 400 });
  }

  const result = await sendMessage({
    businessId: business.id,
    customerPhone: phone,
    kind: "manual",
    body: text || "🧪 הודעת בדיקה ממערכת DOMINANT. אם קיבלת את זה — הכל עובד!",
  });

  return NextResponse.json(result);
}
