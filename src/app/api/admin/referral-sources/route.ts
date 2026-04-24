import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEFAULT_SOURCES = [
  "אינסטגרם", "פייסבוק", "טיקטוק", "גוגל", "חבר הביא חבר", "הגעתי מהרחוב", "אחר",
];

function getSources(settings: string | null): string[] {
  try {
    const parsed = settings ? JSON.parse(settings) : {};
    if (Array.isArray(parsed.referralSources)) return parsed.referralSources;
  } catch { /* ignore */ }
  return DEFAULT_SOURCES;
}

// GET — return current list
export async function GET() {
  const biz = await prisma.business.findFirst({ select: { settings: true } });
  return NextResponse.json(getSources(biz?.settings ?? null));
}

// PUT — overwrite the full list
export async function PUT(req: NextRequest) {
  const body = await req.json();
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: "expected array" }, { status: 400 });
  }
  const sources: string[] = body
    .map((s: unknown) => String(s).trim())
    .filter(Boolean);

  const biz = await prisma.business.findFirst({ select: { id: true, settings: true } });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 400 });

  let current: Record<string, unknown> = {};
  try { current = biz.settings ? JSON.parse(biz.settings) : {}; } catch { /* ignore */ }
  current.referralSources = sources;

  await prisma.business.update({
    where: { id: biz.id },
    data: { settings: JSON.stringify(current) },
  });
  return NextResponse.json(sources);
}
