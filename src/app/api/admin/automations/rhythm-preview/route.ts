import { NextRequest, NextResponse } from "next/server";
import { requireOwner, getRequestSession } from "@/lib/session";
import { runRhythmNudge } from "@/lib/automations/rhythm-nudge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Dry run of "הגיע הזמן לתור" for this business: who would get a message
 *  today and what it would say. Sends nothing. Ignores enabled/notBefore so the
 *  owner can preview before switching it on. */
export async function POST(req: NextRequest) {
  const denied = requireOwner(req);
  if (denied) return denied;
  const session = getRequestSession(req)!;
  const [result] = await runRhythmNudge(new Date(), { dryRun: true, force: true, businessId: session.businessId });
  return NextResponse.json({ ok: true, result: result ?? { scanned: 0, planned: [], skipped: {} } });
}
