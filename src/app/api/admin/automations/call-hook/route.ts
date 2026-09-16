import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const mint = () => randomBytes(24).toString("base64url");
const baseUrl = () => process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";

/** GET — the business's call-hook secret (minted on first read) + the URL to paste into MacroDroid. */
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session?.isOwner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let biz = await prisma.business.findUnique({ where: { id: session.businessId }, select: { callHookSecret: true } });
  if (!biz?.callHookSecret) biz = await prisma.business.update({ where: { id: session.businessId }, data: { callHookSecret: mint() }, select: { callHookSecret: true } });
  return NextResponse.json({ secret: biz.callHookSecret, url: `${baseUrl()}/api/hooks/call` });
}

/** POST — rotate the secret (the old one stops working immediately). */
export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session?.isOwner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const biz = await prisma.business.update({ where: { id: session.businessId }, data: { callHookSecret: mint() }, select: { callHookSecret: true } });
  return NextResponse.json({ secret: biz.callHookSecret, url: `${baseUrl()}/api/hooks/call` });
}
