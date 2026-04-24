import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DEFAULT_SOURCES = [
  "אינסטגרם", "פייסבוק", "טיקטוק", "גוגל", "חבר הביא חבר", "הגעתי מהרחוב", "אחר",
];

// Public — no auth required (used on customer booking confirm page)
export async function GET() {
  const biz = await prisma.business.findFirst({ select: { settings: true } });
  try {
    const parsed = biz?.settings ? JSON.parse(biz.settings) : {};
    if (Array.isArray(parsed.referralSources) && parsed.referralSources.length > 0) {
      return NextResponse.json(parsed.referralSources);
    }
  } catch { /* ignore */ }
  return NextResponse.json(DEFAULT_SOURCES);
}
