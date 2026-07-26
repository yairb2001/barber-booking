/**
 * Onboarding follow-up cron — thin HTTP wrapper.
 * Logic lives in @/lib/agent/onboarding-followup (route files may only export
 * HTTP handlers). Nudges owners who stalled mid-onboarding; see that module
 * for the cadence and stuck-flag rules.
 *
 * Secure with CRON_SECRET: GET /api/cron/onboarding-followup?secret=<CRON_SECRET>
 */
import { NextRequest, NextResponse } from "next/server";
import { runOnboardingFollowup } from "@/lib/agent/onboarding-followup";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const provided =
    searchParams.get("secret") ||
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runOnboardingFollowup();
  return NextResponse.json(result);
}
