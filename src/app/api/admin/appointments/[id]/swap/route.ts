import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";
import { sendMessage, swapProposalText, moveProposalText } from "@/lib/messaging";
import { timeToMinutes } from "@/lib/utils";

/**
 * POST /api/admin/appointments/[id]/swap
 *
 * Initiates one or more proposals from a primary appointment. Each candidate
 * is either:
 *   - { type: "swap", appointmentId }                 — trade with another customer
 *   - { type: "move", staffId, date, startTime }      — relocate primary to a free slot
 *
 * Both kinds send a WhatsApp asking the customer for approval. They share the
 * same SwapProposal lifecycle and 5-candidate cap.
 *
 * Body (preferred):
 *   { candidates: Array<SwapCandidate | MoveCandidate> }
 *
 * Body (legacy — still accepted for forward compatibility):
 *   { candidateIds: string[] } → treated as all "swap" candidates
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

type Candidate =
  | { type: "swap"; appointmentId: string }
  | { type: "move"; staffId: string; date: string; startTime: string };

function parseCandidates(body: unknown): Candidate[] | { error: string } {
  if (!body || typeof body !== "object") return { error: "missing body" };
  const b = body as Record<string, unknown>;

  // Preferred: { candidates: [...] }
  if (Array.isArray(b.candidates)) {
    const out: Candidate[] = [];
    for (const c of b.candidates) {
      if (!c || typeof c !== "object") return { error: "מועמד לא תקין" };
      const t = (c as Record<string, unknown>).type;
      if (t === "swap") {
        const apptId = (c as Record<string, unknown>).appointmentId;
        if (typeof apptId !== "string" || !apptId) return { error: "appointmentId חסר במועמד swap" };
        out.push({ type: "swap", appointmentId: apptId });
      } else if (t === "move") {
        const staffId   = (c as Record<string, unknown>).staffId;
        const date      = (c as Record<string, unknown>).date;
        const startTime = (c as Record<string, unknown>).startTime;
        if (typeof staffId !== "string" || !staffId) return { error: "staffId חסר במועמד move" };
        if (typeof date !== "string" || !date) return { error: "date חסר במועמד move" };
        if (typeof startTime !== "string" || !/^\d{2}:\d{2}$/.test(startTime))
          return { error: "startTime לא תקין במועמד move" };
        out.push({ type: "move", staffId, date, startTime });
      } else {
        return { error: "סוג מועמד לא חוקי" };
      }
    }
    return out;
  }

  // Legacy: { candidateIds: [...] } — treat each as a swap candidate
  if (Array.isArray(b.candidateIds)) {
    const ids = b.candidateIds.filter((x): x is string => typeof x === "string");
    return ids.map(id => ({ type: "swap" as const, appointmentId: id }));
  }

  return { error: "candidates חסר" };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const primaryId = params.id;
  const body = await req.json().catch(() => null);
  const parsed = parseCandidates(body);
  if (!Array.isArray(parsed)) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // De-dupe + cap
  const dedupedSwap = new Set<string>();
  const dedupedMove = new Set<string>(); // key = "staffId|date|startTime"
  const candidates: Candidate[] = [];
  for (const c of parsed) {
    if (c.type === "swap") {
      if (c.appointmentId === primaryId) continue;
      if (dedupedSwap.has(c.appointmentId)) continue;
      dedupedSwap.add(c.appointmentId);
      candidates.push(c);
    } else {
      const key = `${c.staffId}|${c.date}|${c.startTime}`;
      if (dedupedMove.has(key)) continue;
      dedupedMove.add(key);
      candidates.push(c);
    }
  }
  if (candidates.length === 0) return NextResponse.json({ error: "לא נבחר אף מועמד" }, { status: 400 });
  if (candidates.length > 5) return NextResponse.json({ error: "ניתן לבחור עד 5 מועמדים בלבד" }, { status: 400 });

  // Fetch primary
  const primary = await prisma.appointment.findUnique({
    where: { id: primaryId },
    include: { customer: true, staff: true, service: true },
  });
  if (!primary) return NextResponse.json({ error: "התור לא נמצא" }, { status: 404 });

  // Validate "swap" candidates: existence, same business, active status
  const swapIds = candidates.filter((c): c is Extract<Candidate, { type: "swap" }> => c.type === "swap").map(c => c.appointmentId);
  const swapAppts = swapIds.length > 0 ? await prisma.appointment.findMany({
    where: { id: { in: swapIds }, businessId: primary.businessId },
    include: { customer: true, staff: true, service: true },
  }) : [];
  if (swapAppts.length !== swapIds.length) {
    return NextResponse.json({ error: "חלק מהמועמדים לא נמצאו או שייכים לעסק אחר" }, { status: 400 });
  }
  const invalidStatus = swapAppts.find(c => !["confirmed", "pending"].includes(c.status));
  if (invalidStatus) {
    return NextResponse.json(
      { error: `התור של ${invalidStatus.customer.name} אינו פעיל ולכן לא ניתן להציע לו החלפה` },
      { status: 400 }
    );
  }
  const swapApptById = new Map(swapAppts.map(a => [a.id, a]));

  // Validate "move" candidates: target slot must be free (no overlapping appt
  // in pending/confirmed status)
  const moveCandidates = candidates.filter((c): c is Extract<Candidate, { type: "move" }> => c.type === "move");
  const primaryDuration = timeToMinutes(primary.endTime) - timeToMinutes(primary.startTime);
  for (const m of moveCandidates) {
    const startMin = timeToMinutes(m.startTime);
    const endMin = startMin + primaryDuration;
    const dateObj = new Date(m.date.split("T")[0] + "T00:00:00.000Z");
    const overlapping = await prisma.appointment.findMany({
      where: {
        staffId: m.staffId,
        date: dateObj,
        status: { in: ["pending", "confirmed"] },
        id: { not: primary.id }, // primary itself doesn't count
      },
      select: { id: true, startTime: true, endTime: true, customer: { select: { name: true } } },
    });
    const conflict = overlapping.find(apt => {
      const aStart = timeToMinutes(apt.startTime);
      const aEnd   = timeToMinutes(apt.endTime);
      return startMin < aEnd && endMin > aStart;
    });
    if (conflict) {
      return NextResponse.json(
        { error: `השעה ${m.startTime} אינה פנויה (${conflict.customer.name}) — נא לבחור שעה ריקה אחרת` },
        { status: 400 }
      );
    }
    // Ensure the staff exists in this business
    const stf = await prisma.staff.findFirst({ where: { id: m.staffId, businessId: primary.businessId }, select: { id: true } });
    if (!stf) return NextResponse.json({ error: "ספר לא תקין במועמד 'מעבר'" }, { status: 400 });
  }

  // Block if primary or any swap candidate already has an OPEN proposal
  const blockingProposals = await prisma.swapProposal.findMany({
    where: {
      status: { in: CANDIDATE_OPEN_STATUSES },
      OR: [
        { primaryAppointmentId: primaryId },
        { candidateAppointmentId: primaryId },
        ...(swapIds.length > 0 ? [
          { primaryAppointmentId: { in: swapIds } },
          { candidateAppointmentId: { in: swapIds } },
        ] : []),
      ],
    },
    select: { id: true },
  });
  if (blockingProposals.length > 0) {
    return NextResponse.json(
      { error: "יש כבר הצעת החלפה פתוחה על אחד מהתורים. בטל אותה קודם." },
      { status: 409 }
    );
  }

  // Read business once
  const business = await prisma.business.findUnique({ where: { id: primary.businessId } });
  if (!business) return NextResponse.json({ error: "no business" }, { status: 500 });

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const primaryDateLabel = hebDate(primary.date);

  // Build proposals + send jobs
  type SendJob = { phone: string; body: string; appointmentIdForLog: string };
  const sendJobs: SendJob[] = [];
  const proposalIds: string[] = [];

  for (const c of candidates) {
    if (c.type === "swap") {
      const cand = swapApptById.get(c.appointmentId)!;
      const proposal = await prisma.swapProposal.create({
        data: {
          businessId: primary.businessId,
          primaryAppointmentId: primary.id,
          candidateAppointmentId: cand.id,
          kind: "swap",
          status: "pending_response",
          expiresAt,
        },
      });
      proposalIds.push(proposal.id);
      const text = swapProposalText({
        candidateName: cand.customer.name,
        businessName: business.name,
        candidateDateLabel: hebDate(cand.date),
        candidateTime: cand.startTime,
        primaryDateLabel,
        primaryTime: primary.startTime,
        primaryStaffName: primary.staff.name,
      }, business.swapProposalTemplate);
      sendJobs.push({
        phone: cand.customer.phone,
        body: text,
        appointmentIdForLog: cand.id,
      });
    } else {
      // "move" — message goes to PRIMARY's customer (they're the one being moved)
      const dateObj = new Date(c.date.split("T")[0] + "T00:00:00.000Z");
      const targetStaff = await prisma.staff.findUnique({
        where: { id: c.staffId },
        select: { name: true },
      });
      const proposal = await prisma.swapProposal.create({
        data: {
          businessId: primary.businessId,
          primaryAppointmentId: primary.id,
          kind: "move",
          targetStaffId: c.staffId,
          targetDate: dateObj,
          targetStartTime: c.startTime,
          status: "pending_response",
          expiresAt,
        },
      });
      proposalIds.push(proposal.id);
      const text = moveProposalText({
        customerName: primary.customer.name,
        businessName: business.name,
        currentDateLabel: primaryDateLabel,
        currentTime: primary.startTime,
        proposedDateLabel: hebDate(dateObj),
        proposedTime: c.startTime,
        proposedStaffName: targetStaff?.name || primary.staff.name,
      }, business.moveProposalTemplate);
      sendJobs.push({
        phone: primary.customer.phone,
        body: text,
        appointmentIdForLog: primary.id,
      });
    }
  }

  // Send all WhatsApps in parallel — failures don't block the response
  const sendResults = await Promise.all(
    sendJobs.map(j =>
      sendMessage({
        businessId: primary.businessId,
        appointmentId: j.appointmentIdForLog,
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
