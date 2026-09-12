import { NextResponse } from "next/server";
import { BUILD_ID } from "@/lib/build-id";

export const dynamic = "force-dynamic";

/** Which build is live. The client compares with its own BUILD_ID to show
 *  "update available" — the native shell (WKWebView) caches JS aggressively
 *  and otherwise keeps showing the old UI after a deploy. */
export async function GET() {
  return NextResponse.json({ build: BUILD_ID }, { headers: { "Cache-Control": "no-store" } });
}
