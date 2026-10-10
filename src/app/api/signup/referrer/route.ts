import { NextRequest, NextResponse } from "next/server";
import { findReferrer } from "@/lib/chator-referral";

export const dynamic = "force-dynamic";

/**
 * Public: who sent this signup link (GET ?ref=<slug>), for the "הגעת בהמלצה
 * של …" line on /signup. Only the shop's public name, like its booking page.
 */
export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref") ?? "";
  const r = await findReferrer({ ref }).catch(() => null);
  if (!r) return NextResponse.json({ ok: false });
  return NextResponse.json({ ok: true, name: r.name === "המספרה שלי" ? null : r.name });
}
