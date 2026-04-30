import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";
import { sendMessage, swapProposalText } from "@/lib/messaging";

/**
 * POST /api/admin/appointments/[id]/swap
 *
 * Initiates a swap proposal: primary = the appointment in URL, candidates = a
 * 1–5 array sent in body. For each candidate we create a SwapProposal row and
 * fire a WhatsApp asking the customer if they'd trade.
 *
 * Body: { candidateIds: string[] }
 */

const HEBREW_DATE_OPTS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
};

function hebDate(date: Date): string {
  return date.toLocaleDateString("he-IL", HEBREW_DATE_OPTS);
}

const CANDIDATE_OPEN_STATUSES = ["pending_response", "accepted_by_customer"];

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const primaryId = params.id;
  const body = await req.json().catch(() => null);
  const candidateIdsRaw: unknown = body?.candidateIds;

  if (!Array.isArray(candidateIdsRaw) || candidateIdsRaw.length === 0) {
    return NextResponse.json({ error: "נא לבחור לפחות תור מועמד אחד" }, { status: 400 });
  }
  // De-duplicate, validate types, exclude the primary itself
  const candidateIds = Array.from(new Set(
    candidateIdsRaw.filter((x): x is string => typeof x === "string" && x.length > 0)
  )).filter(id => id !== primaryId);

  if (candidateIds.length === 0) {
    return NextResponse.json({ error: "מועמדים לא תקינים" }, { status: 400 });
  }
  if (candidateIds.length > 5) {
    return NextResponse.json({ error: "ניתן לבחור עד 5 מועמדים בלבד" }, { status: 400 });
  }

  // Fetch the primary appointment (with customer/staff/service)
  const primary = await prisma.appointment.findUnique({
    where: { id: primaryId },
    include: { customer: true, staff: true, service: true },
  });
  if (!primary) {
    return NextResponse.json({ error: "התור לא נמצא" }, { status: 404 });
  }

  // Fetch all candidates
  const candidates = await prisma.appointment.findMany({
    where: { id: { in: candidateIds }, businessId: primary.businessId },
    include: { customer: true, staff: true, service: true },
  });
  if (candidates.length !== candidateIds.length) {
    return NextResponse.json(
      { error: "חלק מהמועמדים לא נמצאו או שייכים לעסק אחר" },
      { status: 400 }
    );
  }
  // Only active appointments are valid candidates (don't bother cancelled/completed)
  const invalidStatus = candidates.find(c => !["confirmed", "pending"].includes(c.status));
  if (invalidStatus) {
    return NextResponse.json(
      { error: `התור של ${invalidStatus.customer.name} אינו פעיל ולכן לא ניתן להציע לו החלפה` },
      { status: 400 }
    );
  }

  // Block if there are any OPEN proposals for primary or any candidate
  const blockingProposals = await prisma.swapProposal.findMany({
    where: {
      status: { in: CANDIDATE_OPEN_STATUSES },
      OR: [
        { primaryAppointmentId: primaryId },
        { candidateAppointmentId: primaryId },
        { primaryAppointmentId: { in: candidateIds } },
        { candidateAppointmentId: { in: candidateIds } },
      ],
    },
    select: { id: true, primaryAppointmentId: true, candidateAppointmentId: true },
  });
  if (blockingProposals.length > 0) {
    return NextResponse.json(
      { error: "יש כבר הצעת החלפה פתוחה על אחד מהתורים. בטל אותה קודם." },
      { status: 409 }
    );
  }

  // Read business once (for message templating)
  const business = await prisma.business.findUnique({ where: { id: primary.businessId } });
  if (!business) return NextResponse.json({ error: "no business" }, { status: 500 });

  // Create proposal rows + collect messages to send
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h from now
  const primaryDateLabel = hebDate(primary.date);

  type SendJob = { candidateAppointmentId: string; phone: string; body: string; proposalId: string };
  const sendJobs: SendJob[] = [];
  const proposalIds: string[] = [];

  for (const candidate of candidates) {
    const proposal = await prisma.swapProposal.create({
      data: {
        businessId: primary.businessId,
        primaryAppointmentId: primary.id,
        candidateAppointmentId: candidate.id,
        status: "pending_response",
        expiresAt,
      },
    });
    proposalIds.push(proposal.id);

    const text = swapProposalText({
      candidateName: candidate.customer.name,
      businessName: business.name,
      candidateDateLabel: hebDate(candidate.date),
      candidateTime: candidate.startTime,
      primaryDateLabel,
      primaryTime: primary.startTime,
      primaryStaffName: primary.staff.name,
    }, business.swapProposalTemplate);
    sendJobs.push({
      candidateAppointmentId: candidate.id,
      phone: candidate.customer.phone,
      body: text,
      proposalId: proposal.id,
    });
  }

  // Send all WhatsApps in parallel — failures don't block the response
  const sendResults = await Promise.all(
    sendJobs.map(j =>
      sendMessage({
        businessId: primary.businessId,
        appointmentId: j.candidateAppointmentId,
        customerPhone: j.phone,
        kind: "swap_proposal",
        body: j.body,
      }).catch(err => {
        console.error("swap_proposal send failed:", err);
        return { ok: false, error: String(err) };
      })
    )
  );
  const sent = sendResults.filter(r => r.ok).length;
  const failed = sendResults.filter(r => !r.ok).length;

  return NextResponse.json({ ok: true, proposalIds, sent, failed }, { status: 201 });
}
