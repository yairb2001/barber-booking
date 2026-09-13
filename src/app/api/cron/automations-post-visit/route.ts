import { NextRequest, NextResponse } from "next/server";
import { assertCron } from "@/lib/cron-auth";
import { runPostVisitAutomations } from "@/lib/automations/post-visit";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/automations-post-visit — daily Vercel cron. The every-15-min
 * cadence that `delayMinutes` needs comes from the drip-queue piggyback
 * (vercel.json only allows daily schedules on this plan). Logic lives in
 * src/lib/automations/post-visit.ts.
 */
export async function GET(req: NextRequest) {
  const guard = assertCron(req);
  if (guard) return guard;
  const result = await runPostVisitAutomations();
  return NextResponse.json({ ok: true, ...result });
}
