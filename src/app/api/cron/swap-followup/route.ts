/**
 * Swap / move proposal follow-up cron.
 *
 * After 1 hour of silence from a candidate customer we send one gentle reminder,
 * then leave it alone until the proposal naturally expires.
 *
 * Covers both flow types:
 *   • swap  → reminder goes to the CANDIDATE customer (asked to trade slots)
 *   • move  → reminder goes to the PRIMARY customer   (asked to move to a free slot)
 *
 * Guard: `reminderSentAt` is set on first send — guarantees exactly one nudge
 * per proposal regardless of how often this cron runs.
 *
 * Runs hourly via Vercel Cron. Also accepts Bearer <CRON_SECRET> for manual triggers.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

export const dynamic = "force-dynamic";

const REMINDER_AFTER_MS = 60 * 60 * 1000; // wait 1 h before nudging

const REMINDER_BODY =
  "היי, ראית את ההצעה שלנו לגבי החלפת התור? אם תוכל להחליף אשמח שתגיב";

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

  const now = new Date();
  const reminderCutoff = new Date(now.getTime() - REMINDER_AFTER_MS);

  // Proposals that have been waiting for a reply for at least 1 hour,
  // haven't expired yet, and haven't received a reminder yet.
  const proposals = await prisma.swapProposal.findMany({
    where: {
      status: "pending_response",
      reminderSentAt: null,
      createdAt: { lte: reminderCutoff },
      expiresAt: { gt: now },
    },
    include: {
      candidate: { include: { customer: { select: { phone: true } } } },
      primary:   { include: { customer: { select: { phone: true } } } },
    },
  });

  let sent = 0, skipped = 0;

  for (const proposal of proposals) {
    // Swap → remind the candidate. Move → remind the primary customer.
    const rawPhone =
      proposal.kind === "move"
        ? proposal.primary?.customer.phone
        : proposal.candidate?.customer.phone;

    if (!rawPhone) { skipped++; continue; }

    const phone = normalizeIsraeliPhone(rawPhone);
    const kind  = proposal.kind === "move" ? ("move_proposal" as const) : ("swap_followup" as const);

    try {
      await sendMessage({
        businessId:    proposal.businessId,
        customerPhone: phone,
        kind,
        body: REMINDER_BODY,
      });
      await prisma.swapProposal.update({
        where: { id: proposal.id },
        data:  { reminderSentAt: now },
      });
      sent++;
      console.log(`[swap-followup] reminded ${phone} for proposal ${proposal.id}`);
    } catch (e) {
      console.error("[swap-followup] failed", proposal.id, e);
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, checked: proposals.length });
}
