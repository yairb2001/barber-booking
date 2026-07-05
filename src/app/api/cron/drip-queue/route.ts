/**
 * Drip-queue cron — drains scheduled WhatsApp messages at a human-safe pace.
 *
 * Both bulk paths (broadcast + waitlist) and the reminder scans only ENQUEUE
 * messages into MessageLog with status "scheduled" + a `scheduledFor` time. This
 * endpoint, hit frequently by an external cron service, sends each one at (or
 * after) its target time — but never faster than one message per business per
 * MIN_SEND_GAP, so the WhatsApp number is never flagged for blasting.
 *
 * ── Why a TIME gate, not just a per-run cap ─────────────────────────────────
 * On Vercel Hobby only DAILY crons are allowed, so the every-minute trigger is
 * an EXTERNAL scheduler (cron-job.org). External schedulers can misbehave: if
 * the service is down for a while it may fire a *burst* of catch-up calls all at
 * once. A per-run cap ("1 message per invocation") is defeated by a burst — 60
 * rapid invocations would send 60 messages in seconds (exactly the flood we're
 * preventing). So instead we gate on the *wall-clock time of the last actual
 * send* per business: a business becomes eligible again only once MIN_SEND_GAP
 * has elapsed since its last "sent" message. This caps the true send rate no
 * matter how often — or how bunched — the endpoint is called.
 *
 * ── Reminders only fire if the appointment still exists ─────────────────────
 * A reminder is enqueued up to 24h before it's due. If the customer cancels in
 * between, the scheduled row must NOT be sent. Before delivering any
 * appointment-bound reminder we re-check the appointment: if it's missing or in
 * a cancelled state we mark the row "skipped" and send nothing.
 *
 * Secure with CRON_SECRET: GET /api/cron/drip-queue?secret=<CRON_SECRET>
 * (or header `x-cron-secret`, or `Authorization: Bearer <CRON_SECRET>`).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deliverMessageLog } from "@/lib/messaging";
import { runAgentQuestionFollowup } from "@/app/api/cron/agent-question-followup/route";

export const dynamic = "force-dynamic";

/** Minimum wall-clock gap between two sends for the SAME business. ~1/min keeps
 *  the number safely under WhatsApp's blasting radar. Enforced against the last
 *  message actually marked "sent", so it holds even under a burst of calls. */
const MIN_SEND_GAP_MS = 60 * 1000;

/** Messages per business per run (kept at 1 — the real throttle is the time
 *  gate above; this just avoids sending two in a single invocation). */
const RATE_PER_BUSINESS = 1;

/** How many due rows to scan per run (across all businesses). */
const SCAN_LIMIT = 200;

/** The every-minute drip trigger also drives the "agent asked a question and got
 *  no reply" follow-up, so it needs no separate external cron. Scanning on every
 *  single tick is wasteful, so gate it to at most once per this interval. The
 *  timestamp lives in warm-instance memory — a best-effort throttle; a cold
 *  start just scans a little sooner, which is harmless (the scan is idempotent). */
const QUESTION_FOLLOWUP_EVERY_MS = 5 * 60 * 1000;
let lastQuestionFollowupRun = 0;

/** Appointment-bound reminder kinds that must be re-validated before sending —
 *  a reminder for a cancelled/removed appointment must never go out. */
const APPOINTMENT_REMINDER_KINDS = new Set(["reminder_24h", "reminder_2h"]);

/** Appointment statuses that mean "no longer a live appointment". */
const CANCELLED_STATUSES = new Set([
  "cancelled_by_customer",
  "cancelled_by_staff",
  "no_show",
]);

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
    select: {
      id: true,
      businessId: true,
      customerPhone: true,
      body: true,
      kind: true,
      appointmentId: true,
    },
  });

  if (due.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0, failed: 0, skipped: 0, throttled: 0 });
  }

  // ── Time gate: find each business's last actual send, exclude any business
  // that sent within MIN_SEND_GAP_MS. This is what makes the throttle immune to
  // bursty external-cron behaviour (the cause of the mass-send incident). ──────
  const businessIds = Array.from(new Set(due.map((d) => d.businessId)));
  const lastSends = await prisma.messageLog.findMany({
    where: { businessId: { in: businessIds }, sentAt: { not: null } },
    orderBy: { sentAt: "desc" },
    distinct: ["businessId"],
    select: { businessId: true, sentAt: true },
  });
  const lastSentByBusiness = new Map(
    lastSends.map((r) => [r.businessId, r.sentAt as Date]),
  );
  const businessAllowed = (id: string) => {
    const last = lastSentByBusiness.get(id);
    return !last || now.getTime() - last.getTime() >= MIN_SEND_GAP_MS;
  };

  // Select at most RATE_PER_BUSINESS rows for each business that passed the gate.
  const perBusinessCount = new Map<string, number>();
  let throttled = 0;
  const selected = due.filter((row) => {
    if (!businessAllowed(row.businessId)) { throttled++; return false; }
    const c = perBusinessCount.get(row.businessId) || 0;
    if (c >= RATE_PER_BUSINESS) { throttled++; return false; }
    perBusinessCount.set(row.businessId, c + 1);
    return true;
  });

  if (selected.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0, failed: 0, skipped: 0, throttled });
  }

  // Claim the selected rows so overlapping runs can't double-send: flip
  // "scheduled" → "sending" atomically; only rows we actually claimed proceed.
  const selectedIds = selected.map((r) => r.id);
  const claim = await prisma.messageLog.updateMany({
    where: { id: { in: selectedIds }, status: "scheduled" },
    data: { status: "sending" },
  });

  // If nothing was claimed (another run beat us), exit cleanly.
  if (claim.count === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0, failed: 0, skipped: 0, throttled });
  }

  // Re-fetch the rows we now own (status "sending") to be safe.
  const claimed = await prisma.messageLog.findMany({
    where: { id: { in: selectedIds }, status: "sending" },
    select: {
      id: true,
      businessId: true,
      customerPhone: true,
      body: true,
      kind: true,
      appointmentId: true,
    },
  });

  // ── Re-validate appointment-bound reminders: only send if the appointment is
  // still live. A cancellation between enqueue and send must suppress it. ──────
  const reminderApptIds = Array.from(
    new Set(
      claimed
        .filter((r) => APPOINTMENT_REMINDER_KINDS.has(r.kind) && r.appointmentId)
        .map((r) => r.appointmentId as string),
    ),
  );
  const apptStatusById = new Map<string, string>();
  if (reminderApptIds.length > 0) {
    const appts = await prisma.appointment.findMany({
      where: { id: { in: reminderApptIds } },
      select: { id: true, status: true },
    });
    for (const a of appts) apptStatusById.set(a.id, a.status);
  }

  let skipped = 0;
  const toDeliver: typeof claimed = [];
  for (const row of claimed) {
    if (APPOINTMENT_REMINDER_KINDS.has(row.kind) && row.appointmentId) {
      const status = apptStatusById.get(row.appointmentId);
      // Missing appointment (deleted) or a cancelled/no-show status → suppress.
      if (!status || CANCELLED_STATUSES.has(status)) {
        await prisma.messageLog.update({
          where: { id: row.id },
          data: { status: "skipped", error: "appointment_not_active" },
        });
        skipped++;
        continue;
      }
    }
    toDeliver.push(row);
  }

  if (toDeliver.length === 0) {
    return NextResponse.json({ ok: true, processed: claimed.length, sent: 0, failed: 0, skipped, throttled });
  }

  // Cache businesses (usually one per run).
  const deliverBusinessIds = Array.from(new Set(toDeliver.map((r) => r.businessId)));
  const businesses = await prisma.business.findMany({
    where: { id: { in: deliverBusinessIds } },
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
  for (const row of toDeliver) {
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

  // Piggyback the question follow-up on this every-minute trigger (throttled),
  // so it runs without a dedicated external cron. Never let it break the drip
  // queue — the message delivery above is the critical path.
  const nowMs = Date.now();
  if (nowMs - lastQuestionFollowupRun >= QUESTION_FOLLOWUP_EVERY_MS) {
    lastQuestionFollowupRun = nowMs;
    try {
      await runAgentQuestionFollowup();
    } catch (err) {
      console.error("[drip-queue] question-followup failed:", err);
    }
  }

  return NextResponse.json({ ok: true, processed: claimed.length, sent, failed, skipped, throttled });
}
