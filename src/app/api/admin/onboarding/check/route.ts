import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { setupIssues } from "@/lib/setup-check";
import { runSetupTestChats } from "@/lib/agent/setup-test-chats";

/**
 * The check before "הפעל" (28.10.2026, spec "הקמה עצמית ליופי").
 *   GET  → { issues }  what in the team and services would make the agent book wrong
 *   POST → { chats }   test chats through the real agent, sandbox (nothing sent or saved)
 */
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const business = await getSessionBusiness(req, { id: true });
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });
  return NextResponse.json({ issues: await setupIssues(business.id) });
}

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const business = await getSessionBusiness(req, { id: true });
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });
  return NextResponse.json({ chats: await runSetupTestChats(business.id) });
}
