/**
 * GET /api/cron/barber-daily-summary
 * DISABLED — turned off per owner request.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, skipped: true });
}
