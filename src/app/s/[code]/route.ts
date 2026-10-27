import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redirectTo } from "@/lib/redirect";

export const dynamic = "force-dynamic";

/** GET /s/<code> — a short link from a WhatsApp message (src/lib/short-links.ts). */
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const code = (params.code || "").trim();
  const row = /^[2-9A-Za-z]{6,16}$/.test(code) ? await prisma.shortLink.findUnique({ where: { code }, select: { url: true } }) : null;
  return row?.url ? NextResponse.redirect(row.url, 302) : redirectTo("/");
}
