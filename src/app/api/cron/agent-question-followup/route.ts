/**
 * Agent question follow-up cron — thin HTTP wrapper.
 * All logic lives in @/lib/agent/question-followup (a route file may only export
 * HTTP handlers, so the reusable scan can't live here). The every-minute
 * drip-queue also drives the same function, so this endpoint is optional.
 *
 * Secure with CRON_SECRET: GET /api/cron/agent-question-followup?secret=<CRON_SECRET>
 */
import { NextRequest, NextResponse } from "next/server";
import { runAgentQuestionFollowup } from "@/lib/agent/question-followup";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const provided =
    searchParams.get("secret") ||
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (process.env.CRON_SECRET && provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runAgentQuestionFollowup();
  return NextResponse.json(result);
}
