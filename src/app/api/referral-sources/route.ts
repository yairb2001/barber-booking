import { NextRequest, NextResponse } from "next/server";
import { resolveBusiness } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const DEFAULT_SOURCES = [
  "אינסטגרם", "פייסבוק", "טיקטוק", "גוגל", "חבר הביא חבר", "הגעתי מהרחוב", "אחר",
];

// Public — no auth required (used on customer booking confirm page)
export async function GET(req: NextRequest) {
  const biz = await resolveBusiness(req, { settings: true });
  try {
    const parsed = biz?.settings ? JSON.parse(biz.settings) : {};
    if (Array.isArray(parsed.referralSources) && parsed.referralSources.length > 0) {
      return NextResponse.json(parsed.referralSources);
    }
  } catch { /* ignore */ }
  return NextResponse.json(DEFAULT_SOURCES);
}
