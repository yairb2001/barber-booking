import { NextRequest, NextResponse } from "next/server";

// Fail-CLOSED cron authentication.
//
// Every cron endpoint performs real, irreversible work (mass WhatsApp sends =
// money + ban risk, bulk data deletion). We therefore REQUIRE CRON_SECRET to be
// configured AND to match — a missing env var refuses the request (503) instead
// of running wide open. Accepts the secret three ways so both Vercel Cron
// (Authorization: Bearer <CRON_SECRET>) and external schedulers (?secret= or
// x-cron-secret) work.
export function assertCron(req: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  const provided =
    new URL(req.url).searchParams.get("secret") ||
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
