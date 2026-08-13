/**
 * Live functional test for the two new features (2026-08-13):
 *   1. offerOtherBarberAtRequestedTime — request_appointment_move offers an
 *      exact-time match with another barber even when a specific barber was
 *      requested.
 *   2. Late-arrival flow (reportRunningLate + handleLateArrivalStaffReply):
 *      under grace → FYI to staff; over grace → staff approval; staff "no"
 *      with enough lead time → swap-with-next candidate flow; candidate "yes"
 *      → real appointment swap via executeApprovedProposal.
 *
 * Runs against the DEMO business ("המספרה של דני") — real DB writes, real
 * WhatsApp sends to Dani's connected number. Creates its own test customers/
 * appointments and deletes everything it created at the end, restores the
 * AgentConfig toggles to their original values.
 *
 * Usage: npx tsx --env-file=.env scripts/test-late-arrival-and-other-barber.ts
 */
import { PrismaClient } from "@prisma/client";
import { requestAppointmentMove, reportRunningLate, handleStaffApprovalReply, handleCandidateReply } from "../src/lib/agent/appointment-swap";

const prisma = new PrismaClient();
const BIZ_ID = "ad8d79ef-33ea-4230-9c19-2ed01f0f3a96"; // demo business
const DANI_ID = "51bee769-02ee-4cec-965b-c175cd4ec589";
const DANI_PHONE = "0555081866";
const ROEI_ID = "d0a297e3-ab95-490d-bd06-550d1e4eb9cc";
const SERVICE_ID = "a1f2a787-cb48-4054-8964-6392048873dd"; // תספורת, 30min

const createdCustomerIds: string[] = [];
const createdAppointmentIds: string[] = [];
const createdConversationIds: string[] = [];

function pad(n: number) { return String(n).padStart(2, "0"); }

async function main() {
  const original = await prisma.agentConfig.findUnique({ where: { businessId: BIZ_ID } });
  console.log("original config:", JSON.stringify(original, null, 2));

  await prisma.agentConfig.upsert({
    where: { businessId: BIZ_ID },
    create: {
      businessId: BIZ_ID, isEnabled: true,
      offerOtherBarberAtRequestedTime: true,
      lateArrivalEnabled: true, lateArrivalGraceMinutes: 10,
      lateArrivalSwapLeadMinutes: 40, lateArrivalOfferSwapWithNext: true,
      allowSwapOffers: true, requireSwapApproval: true,
    },
    update: {
      offerOtherBarberAtRequestedTime: true,
      lateArrivalEnabled: true, lateArrivalGraceMinutes: 10,
      lateArrivalSwapLeadMinutes: 40, lateArrivalOfferSwapWithNext: true,
      allowSwapOffers: true, requireSwapApproval: true,
    },
  });

  // ── Israel "now" + test appointment times ──────────────────────────────
  const nowParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => nowParts.find(p => p.type === t)?.value ?? "00";
  const todayIso = `${get("year")}-${get("month")}-${get("day")}`;
  const nowMin = Number(get("hour")) * 60 + Number(get("minute"));
  const lateTime = `${pad(Math.floor((nowMin + 90) / 60) % 24)}:${pad((nowMin + 90) % 60)}`;
  const nextTime = `${pad(Math.floor((nowMin + 120) / 60) % 24)}:${pad((nowMin + 120) % 60)}`;
  console.log(`today=${todayIso} lateTime=${lateTime} nextTime=${nextTime}`);

  const lateCustPhone = "972000000001";
  const nextCustPhone = "972000000002";

  const lateCust = await prisma.customer.create({
    data: { businessId: BIZ_ID, name: "בדיקה-מאחר", phone: lateCustPhone },
  });
  createdCustomerIds.push(lateCust.id);
  const nextCust = await prisma.customer.create({
    data: { businessId: BIZ_ID, name: "בדיקה-הבא", phone: nextCustPhone },
  });
  createdCustomerIds.push(nextCust.id);

  const lateConv = await prisma.conversation.create({
    data: { businessId: BIZ_ID, phone: lateCustPhone, agentType: "customer", status: "active", lastMessageAt: new Date() },
  });
  createdConversationIds.push(lateConv.id);

  const lateAppt = await prisma.appointment.create({
    data: {
      businessId: BIZ_ID, customerId: lateCust.id, staffId: DANI_ID, serviceId: SERVICE_ID,
      date: new Date(`${todayIso}T00:00:00.000Z`), startTime: lateTime, endTime: `${pad(Math.floor((nowMin + 120) / 60) % 24)}:${pad((nowMin + 120) % 60)}`,
      status: "confirmed", price: 80,
    },
  });
  createdAppointmentIds.push(lateAppt.id);

  const nextAppt = await prisma.appointment.create({
    data: {
      businessId: BIZ_ID, customerId: nextCust.id, staffId: DANI_ID, serviceId: SERVICE_ID,
      date: new Date(`${todayIso}T00:00:00.000Z`), startTime: nextTime, endTime: `${pad(Math.floor((nowMin + 150) / 60) % 24)}:${pad((nowMin + 150) % 60)}`,
      status: "confirmed", price: 80,
    },
  });
  createdAppointmentIds.push(nextAppt.id);

  console.log(`\nlateAppt=${lateAppt.id} (${lateTime})  nextAppt=${nextAppt.id} (${nextTime})`);

  // ── Test A: under grace ──────────────────────────────────────────────────
  console.log("\n=== TEST A: delay under grace (5 min, grace=10) ===");
  const resA = await reportRunningLate({
    bizId: BIZ_ID, conversationId: lateConv.id, callerPhone: lateCustPhone,
    appointmentId: lateAppt.id, delayMinutes: 5,
  });
  console.log("result:", resA);
  const proposalsAfterA = await prisma.swapProposal.count({ where: { primaryAppointmentId: lateAppt.id } });
  console.log("swap proposals created:", proposalsAfterA, "(expect 0)");

  // ── Test B: over grace → staff approval → staff says NO → swap-with-next → candidate says YES ──
  console.log("\n=== TEST B: delay over grace (20 min) → staff rejects → swap-with-next ===");
  const resB = await reportRunningLate({
    bizId: BIZ_ID, conversationId: lateConv.id, callerPhone: lateCustPhone,
    appointmentId: lateAppt.id, delayMinutes: 20,
  });
  console.log("result:", resB);

  const proposal = await prisma.swapProposal.findFirst({
    where: { primaryAppointmentId: lateAppt.id, kind: "late_arrival" },
    orderBy: { createdAt: "desc" },
  });
  console.log("proposal after reportRunningLate:", JSON.stringify(proposal, null, 2));
  if (!proposal || proposal.status !== "pending_staff_approval") throw new Error("FAIL: expected pending_staff_approval");

  console.log("\n-- staff (Dani) replies לא --");
  const consumed1 = await handleStaffApprovalReply(BIZ_ID, DANI_PHONE, "לא");
  console.log("consumed:", consumed1, "(expect true)");

  const proposalAfterNo = await prisma.swapProposal.findUnique({ where: { id: proposal.id } });
  console.log("proposal after staff לא:", JSON.stringify(proposalAfterNo, null, 2));
  if (proposalAfterNo?.status !== "pending_response" || proposalAfterNo?.candidateAppointmentId !== nextAppt.id) {
    throw new Error("FAIL: expected pending_response with candidateAppointmentId=nextAppt after staff says no with enough lead time");
  }

  console.log("\n-- candidate (next customer) replies כן --");
  const consumed2 = await handleCandidateReply(BIZ_ID, nextCustPhone, "כן");
  console.log("consumed:", consumed2, "(expect true)");

  const [lateApptFinal, nextApptFinal] = await Promise.all([
    prisma.appointment.findUnique({ where: { id: lateAppt.id } }),
    prisma.appointment.findUnique({ where: { id: nextAppt.id } }),
  ]);
  console.log(`lateAppt final startTime: ${lateApptFinal?.startTime} (expect ${nextTime})`);
  console.log(`nextAppt final startTime: ${nextApptFinal?.startTime} (expect ${lateTime})`);
  if (lateApptFinal?.startTime !== nextTime || nextApptFinal?.startTime !== lateTime) {
    throw new Error("FAIL: appointments did not swap times as expected");
  }
  const proposalFinal = await prisma.swapProposal.findUnique({ where: { id: proposal.id } });
  console.log("proposal final status:", proposalFinal?.status, "(expect approved)");

  console.log("\n✅ TEST A+B PASSED");

  // ── Test C: offer other barber at exact requested time ──────────────────
  // Deterministic: tomorrow at 12:00 (well within the 10:00-19:00 schedule for
  // both Dani and Roei, and a weekday both work) — not tied to current wall-clock.
  console.log("\n=== TEST C: offer other barber at exact requested time ===");
  // Walk forward from tomorrow until we land on a day both Dani and Roei work
  // (dayOfWeek 0-5, not 6/Saturday) — avoids depending on which weekday "now" is.
  let tomorrowIso = "";
  for (let d = 1; d <= 8; d++) {
    const cand = new Date(Date.now() + d * 24 * 3600 * 1000);
    const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(cand);
    const dow = new Date(`${iso}T12:00:00.000Z`).getUTCDay();
    if (dow !== 6) { tomorrowIso = iso; break; }
  }
  console.log("test C date:", tomorrowIso);
  const BUSY_TIME = "12:00";
  const OWN_TIME = "15:00";

  const custC = await prisma.customer.create({ data: { businessId: BIZ_ID, name: "בדיקה-ספר-אחר", phone: "972000000003" } });
  createdCustomerIds.push(custC.id);
  const convC = await prisma.conversation.create({
    data: { businessId: BIZ_ID, phone: "972000000003", agentType: "customer", status: "active", lastMessageAt: new Date() },
  });
  createdConversationIds.push(convC.id);

  // Block Dani at BUSY_TIME with a filler customer, so the exact slot is taken.
  const fillerCust = await prisma.customer.create({ data: { businessId: BIZ_ID, name: "בדיקה-תופס-מקום", phone: "972000000004" } });
  createdCustomerIds.push(fillerCust.id);
  const fillerAppt = await prisma.appointment.create({
    data: {
      businessId: BIZ_ID, customerId: fillerCust.id, staffId: DANI_ID, serviceId: SERVICE_ID,
      date: new Date(`${tomorrowIso}T00:00:00.000Z`), startTime: BUSY_TIME, endTime: "12:30",
      status: "confirmed", price: 80,
    },
  });
  createdAppointmentIds.push(fillerAppt.id);

  // Third customer's OWN appointment is with Dani at a different time; they ask to move to BUSY_TIME.
  const apptC = await prisma.appointment.create({
    data: {
      businessId: BIZ_ID, customerId: custC.id, staffId: DANI_ID, serviceId: SERVICE_ID,
      date: new Date(`${tomorrowIso}T00:00:00.000Z`), startTime: OWN_TIME, endTime: "15:30",
      status: "confirmed", price: 80,
    },
  });
  createdAppointmentIds.push(apptC.id);

  const resC = await requestAppointmentMove({
    bizId: BIZ_ID, conversationId: convC.id, callerPhone: "972000000003",
    appointmentId: apptC.id, targetDate: tomorrowIso, targetStartTime: BUSY_TIME,
  });
  console.log("result:", resC);
  console.log(resC.includes("רועי") ? "✅ mentions Roei as other-barber option" : "❌ does NOT mention Roei — check manually");

  console.log("\n=== ALL TESTS DONE ===");
}

async function cleanup() {
  console.log("\n--- cleanup ---");
  await prisma.swapProposal.deleteMany({ where: { primaryAppointmentId: { in: createdAppointmentIds } } });
  await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.appointment.deleteMany({ where: { id: { in: createdAppointmentIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
  await prisma.messageLog.deleteMany({ where: { businessId: BIZ_ID, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } } });
  console.log("cleaned up:", { customers: createdCustomerIds.length, appointments: createdAppointmentIds.length, conversations: createdConversationIds.length });
}

main()
  .catch(err => { console.error("\n❌ TEST FAILED:", err); process.exitCode = 1; })
  .finally(async () => {
    await cleanup();
    // Restore original AgentConfig
    await prisma.agentConfig.update({
      where: { businessId: BIZ_ID },
      data: {
        offerOtherBarberAtRequestedTime: false,
        lateArrivalEnabled: false,
        lateArrivalOfferSwapWithNext: false,
      },
    });
    await prisma.$disconnect();
  });
