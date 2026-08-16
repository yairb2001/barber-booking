/**
 * Internal QA self-test endpoint — NOT part of the product.
 *
 * Lets Shimiqa's self-test harness (scripts/self-test.mjs) call the real
 * customer-agent logic directly (runCustomerAgent), against the real DB, from
 * a local dev server — instead of faking a WhatsApp webhook payload. See
 * qa-agent-dominant-spec.md ("סביבת בדיקה + בדיקה עצמית").
 *
 * Locked down so it's inert even if this file ever ships to production:
 *  - Requires QA_SELFTEST_SECRET to be set AND match the request header.
 *    QA_SELFTEST_SECRET is only ever set in the local .env, never in Vercel.
 *  - Hardcoded to the DOMINANT businessId — can't be pointed at another tenant.
 */
import { NextRequest, NextResponse } from "next/server";
import { runCustomerAgent } from "@/lib/agent/customer-agent";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

const BIZ = "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2"; // DOMINANT

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-qa-secret") || "";
  if (!process.env.QA_SELFTEST_SECRET || secret !== process.env.QA_SELFTEST_SECRET) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null) as { phone?: string; message?: string } | null;
  if (!body?.phone || !body?.message) {
    return NextResponse.json({ error: "phone and message required" }, { status: 400 });
  }

  const phone = normalizeIsraeliPhone(body.phone);
  await runCustomerAgent({
    businessId: BIZ,
    phone,
    incomingText: body.message,
    alreadyPersisted: false,
  });

  return NextResponse.json({ ok: true });
}
