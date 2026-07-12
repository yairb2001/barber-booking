/**
 * Daily QA review cron.
 *
 * Runs the deterministic QA detectors over yesterday's conversations and sends
 * the owner a short WhatsApp digest of anything worth checking. Pure detection —
 * NO LLM, NO tokens. The verify + fix-drafting + approval happens in Claude Code
 * (on the owner's subscription); this job is just the daily "heads-up".
 *
 * Opt-in per business: settings.qaAgentEnabled === true (currently dominant).
 * Owner recipient: settings.ownerLoginPhone.
 *
 * Secure with CRON_SECRET: GET /api/cron/qa-review?secret=<CRON_SECRET>
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { runQaDetectors, formatDigest } from "@/lib/qa/detectors";

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

  const businesses = await prisma.business.findMany({ select: { id: true, settings: true } });
  const results: Array<{ businessId: string; findings: number; sent: boolean }> = [];

  for (const biz of businesses) {
    let settings: Record<string, unknown> = {};
    try { settings = biz.settings ? JSON.parse(biz.settings) : {}; } catch { /* ignore */ }
    if (settings.qaAgentEnabled !== true) continue;

    const findings = await runQaDetectors(biz.id, 1);
    let sent = false;
    // Only nudge when there's something to look at — no daily "all clear" noise.
    if (findings.length) {
      const ownerPhone = settings.ownerLoginPhone
        ? normalizeIsraeliPhone(String(settings.ownerLoginPhone))
        : null;
      if (ownerPhone) {
        const r = await sendMessage({ businessId: biz.id, customerPhone: ownerPhone, kind: "qa_report", body: formatDigest(findings) });
        sent = r.ok;
      }
    }
    results.push({ businessId: biz.id, findings: findings.length, sent });
  }

  return NextResponse.json({ ok: true, results });
}
