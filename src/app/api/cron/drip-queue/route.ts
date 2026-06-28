/**
 * Drip-queue cron — drains scheduled WhatsApp messages at a human-safe pace.
 *
 * Both bulk paths (broadcast + waitlist) only ENQUEUE messages into MessageLog
 * with status "scheduled" + a `scheduledFor` time. This endpoint, called every
 * minute by an external cron service, sends at most RATE messages PER BUSINESS
 * per run (RATE=1 ⇒ ~1 message/minute per WhatsApp number) so the number is
 * never flagged for blasting. Broadcast and waitlist share the same queue, so
 * the per-number rate stays safe regardless of how many are pending.
 *
 * Secure with CRON_SECRET: GET /api/cron/drip-queue?secret=<CRON_SECRET>
 * (or header `x-cron-secret`).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deliverMessageLog } from "@/lib/messaging";

export const dynamic = "force-dynamic";

/** Max messages sent per business per cron run. With a 1/min external cron this
 *  yields ~1 message/minute per number — the slow-and-safe pace. */
const RATE_PER_BUSINESS = 1;

/** How many due rows to scan per run (across all businesses). */
const SCAN_LIMIT = 200;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // Accept every auth style our cron endpoints use, so this can be wired into an
  // existing external cron service regardless of how its other jobs authenticate:
  //   • ?secret=<CRON_SECRET>            (query string)
  //   • x-cron-secret: <CRON_SECRET>     (custom header)
  //   • Authorization: Bearer <CRON_SECRET>  (what reminders-2h / automations use)
  const secret =
    searchParams.get("secret") ||
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Pull due scheduled messages, oldest scheduledFor first (FIFO + priority:
  // waitlist enqueues with scheduledFor=now, broadcast staggers into the future,
  // so freed-slot notifications naturally jump ahead of a long broadcast).
  const due = await prisma.messageLog.findMany({
    where: { status: "scheduled", scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: SCAN_LIMIT,
    select: { id: true, businessId: true, customerPhone: true, body: true },
  });

  if (due.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0, failed: 0 });
  }

  // Cap to RATE_PER_BUSINESS per business this run.
  const perBusinessCount = new Map<string, number>();
  const selected = due.filter((row) => {
    const c = perBusinessCount.get(row.businessId) || 0;
    if (c >= RATE_PER_BUSINESS) return false;
    perBusinessCount.set(row.businessId, c + 1);
    return true;
  });

  // Claim the selected rows so overlapping runs can't double-send: flip
  // "scheduled" → "sending" atomically; only rows we actually claimed proceed.
  const selectedIds = selected.map((r) => r.id);
  const claim = await prisma.messageLog.updateMany({
    where: { id: { in: selectedIds }, status: "scheduled" },
    data: { status: "sending" },
  });

  // If nothing was claimed (another run beat us), exit cleanly.
  if (claim.count === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0, failed: 0 });
  }

  // Re-fetch the rows we now own (status "sending") to be safe.
  const claimed = await prisma.messageLog.findMany({
    where: { id: { in: selectedIds }, status: "sending" },
    select: { id: true, businessId: true, customerPhone: true, body: true },
  });

  // Cache businesses (usually one per run).
  const businessIds = Array.from(new Set(claimed.map((r) => r.businessId)));
  const businesses = await prisma.business.findMany({
    where: { id: { in: businessIds } },
    select: {
      id: true,
      messagingProvider: true,
      whatsappNumber: true,
      greenApiInstanceId: true,
      greenApiToken: true,
    },
  });
  const businessById = new Map(businesses.map((b) => [b.id, b]));

  let sent = 0, failed = 0;
  for (const row of claimed) {
    const business = businessById.get(row.businessId);
    if (!business) {
      await prisma.messageLog.update({
        where: { id: row.id },
        data: { status: "failed", error: "business_not_found" },
      });
      failed++;
      continue;
    }
    try {
      const result = await deliverMessageLog(row, business);
      if (result.ok) sent++; else failed++;
    } catch (err) {
      console.error("[drip-queue] send failed:", err);
      await prisma.messageLog.update({
        where: { id: row.id },
        data: { status: "failed", error: err instanceof Error ? err.message : "send_error" },
      }).catch(() => {});
      failed++;
    }
  }

  return NextResponse.json({ ok: true, processed: claimed.length, sent, failed });
}
