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
  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const businesses = await prisma.business.findMany({ select: { id: true, settings: true } });
  const results: Array<{ businessId: string; findings: number; fresh: number; sent: boolean }> = [];

  for (const biz of businesses) {
    let settings: Record<string, unknown> = {};
    try { settings = biz.settings ? JSON.parse(biz.settings) : {}; } catch { /* ignore */ }
    if (settings.qaAgentEnabled !== true) continue;

    const findings = await runQaDetectors(biz.id, 1);

    // Mirror findings into the approval panel (deduped), so the morning WhatsApp
    // digest and /admin/qa stay in sync — the nudge says "open the panel", and
    // the items are actually there. Dedup on (conversation, type) for 14 days so
    // a still-active chat isn't re-added every morning, and items the owner
    // already triaged don't reappear.
    const dedupSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const freshFindings: typeof findings = [];
    for (const fnd of findings) {
      if (!fnd.conversationId) continue;
      const existing = await prisma.qaSuggestion.findFirst({
        where: { businessId: biz.id, conversationId: fnd.conversationId, type: fnd.type, createdAt: { gte: dedupSince } },
        select: { id: true, status: true },
      });
      if (existing) {
        // Already has a card. Only still-pending items are worth re-nudging;
        // ones the owner already flagged/rejected must NOT reappear in the digest.
        if (existing.status === "pending") freshFindings.push(fnd);
        continue;
      }
      freshFindings.push(fnd);
      await prisma.qaSuggestion.create({
        data: {
          businessId: biz.id,
          type: fnd.type,
          klass: fnd.klass,
          severity: fnd.severity,
          title: fnd.evidence,
          detail: `${fnd.who}${fnd.confidence === "confirmed" ? " · מאומת" : " · לבדוק"}`,
          conversationId: fnd.conversationId,
          proposedFix: null,
        },
      });
    }

    let sent = false;
    // Send a short digest every day so the owner always knows the check ran —
    // findings on a problem day, "✅ all clear" on a clean one. Only re-nudges
    // about un-triaged items (freshFindings); already-handled ones stay silent.
    const ownerPhone = settings.ownerLoginPhone
      ? normalizeIsraeliPhone(String(settings.ownerLoginPhone))
      : null;
    if (ownerPhone) {
      const r = await sendMessage({ businessId: biz.id, customerPhone: ownerPhone, kind: "qa_report", body: formatDigest(freshFindings) });
      sent = r.ok;
    }
    results.push({ businessId: biz.id, findings: findings.length, fresh: freshFindings.length, sent });
  }

  return NextResponse.json({ ok: true, results });
}
