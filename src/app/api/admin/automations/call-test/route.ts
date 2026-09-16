import { NextRequest, NextResponse } from "next/server";
import { getRequestSession } from "@/lib/session";
import { handleCallEvent } from "@/lib/automations/call-events";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** POST { phone, outcome } — simulate a call from that number (owner only). Sends the real message. */
export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session?.isOwner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "").trim();
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
  const outcome = body.outcome === "answered" ? "answered" : "missed";
  const result = await handleCallEvent({ businessId: session.businessId, phone, direction: "in", outcome, device: "test" });
  return NextResponse.json(result);
}
