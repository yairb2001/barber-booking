import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";

const OTP_TTL_MINUTES = 10;

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/otp/send
// Body: { phone: string, businessId?: string }
// Creates a 6-digit OTP, stores it in DB, sends via WhatsApp, returns { ok: true }
export async function POST(req: NextRequest) {
  const { phone, businessId: reqBusinessId } = await req.json();
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  // Normalize phone — strip non-digits, handle leading 0 → Israeli 972 prefix
  const normalized = phone.replace(/\D/g, "").replace(/^0/, "972");

  const business = reqBusinessId
    ? await prisma.business.findUnique({ where: { id: reqBusinessId } })
    : await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "business not found" }, { status: 400 });

  // Rate-limit: no more than 3 OTPs per phone per 10 minutes
  const recentCount = await prisma.otpCode.count({
    where: {
      businessId: business.id,
      phone: normalized,
      createdAt: { gte: new Date(Date.now() - OTP_TTL_MINUTES * 60 * 1000) },
    },
  });
  if (recentCount >= 3) {
    return NextResponse.json({ error: "יותר מדי ניסיונות — נסה שוב בעוד מספר דקות" }, { status: 429 });
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await prisma.otpCode.create({
    data: { businessId: business.id, phone: normalized, code, expiresAt },
  });

  // Send WhatsApp message
  const body = `קוד האימות שלך ב-${business.name} הוא: *${code}*\n\nהקוד תקף ל-${OTP_TTL_MINUTES} דקות.`;
  await sendMessage({
    businessId: business.id,
    customerPhone: normalized,
    kind: "otp",
    body,
  });

  return NextResponse.json({ ok: true });
}
