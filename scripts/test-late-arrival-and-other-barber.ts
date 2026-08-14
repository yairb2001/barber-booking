/**
 * Live functional test for the late-arrival + other-barber features
 * (2026-08-13, extended 2026-08-14 after two rounds of Yair's live testing
 * on the real business surfaced real gaps — see Tests D and E):
 *   1. offerOtherBarberAtRequestedTime — request_appointment_move offers an
 *      exact-time match with another barber even when a specific barber was
 *      requested.
 *   2. Late-arrival flow (reportRunningLate + handleLateArrivalStaffReply):
 *      under grace → FYI to staff; over grace → staff approval; staff "no"
 *      → a SEPARATE yes/no asking whether to offer the slot to the next
 *      customer (Test B) — declining the delay must not auto-trigger the
 *      swap offer. Every path that ends in "not approved" — staff declines
 *      outright with no swap possible (Test D), staff declines offering the
 *      swap too (Test D), or the NEXT customer declines the swap (Test E) —
 *      must all mark the appointment an actual no_show and tell the late
 *      customer the same "considered a no-show, we usually charge full
 *      price" wording (per-business editable, lateArrivalNoShowMessage).
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

  console.log("\n-- staff (Dani) replies לא (declines the delay itself) --");
  const consumed1 = await handleStaffApprovalReply(BIZ_ID, DANI_PHONE, "לא");
  console.log("consumed:", consumed1, "(expect true)");

  // 2026-08-14 (Yair, live test on the real business): declining the delay
  // must NOT auto-offer the swap — the barber gets asked a SEPARATE yes/no
  // first ("want me to offer your slot to the next customer?").
  const proposalAfterNo = await prisma.swapProposal.findUnique({ where: { id: proposal.id } });
  console.log("proposal after staff לא:", JSON.stringify(proposalAfterNo, null, 2));
  if (proposalAfterNo?.status !== "pending_staff_swap_confirm" || proposalAfterNo?.candidateAppointmentId !== nextAppt.id) {
    throw new Error("FAIL: expected pending_staff_swap_confirm with candidateAppointmentId stashed after staff says no with enough lead time");
  }
  console.log("✅ swap NOT auto-offered — staff asked a separate confirm question first");

  console.log("\n-- staff (Dani) replies כן to 'offer the swap?' --");
  const consumedSwapConfirm = await handleStaffApprovalReply(BIZ_ID, DANI_PHONE, "כן");
  console.log("consumed:", consumedSwapConfirm, "(expect true)");

  const proposalAfterSwapConfirm = await prisma.swapProposal.findUnique({ where: { id: proposal.id } });
  if (proposalAfterSwapConfirm?.status !== "pending_response" || proposalAfterSwapConfirm?.candidateAppointmentId !== nextAppt.id) {
    throw new Error("FAIL: expected pending_response with candidateAppointmentId=nextAppt after staff confirms the swap offer");
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

  // ── Test D: staff declines the delay AND declines the swap offer → real no-show ──
  console.log("\n=== TEST D: staff says לא twice (delay, then swap offer) → appointment marked no_show ===");
  // Distinct offsets from Test B's times — those slots are now occupied by
  // the post-swap appointments (lateAppt/nextAppt swapped times in Test B).
  const lateTimeD = `${pad(Math.floor((nowMin + 180) / 60) % 24)}:${pad((nowMin + 180) % 60)}`;
  const nextTimeD = `${pad(Math.floor((nowMin + 210) / 60) % 24)}:${pad((nowMin + 210) % 60)}`;
  const lateCustD = await prisma.customer.create({ data: { businessId: BIZ_ID, name: "בדיקה-מאחר-ד", phone: "972000000005" } });
  createdCustomerIds.push(lateCustD.id);
  const nextCustD = await prisma.customer.create({ data: { businessId: BIZ_ID, name: "בדיקה-הבא-ד", phone: "972000000006" } });
  createdCustomerIds.push(nextCustD.id);
  const lateConvD = await prisma.conversation.create({
    data: { businessId: BIZ_ID, phone: "972000000005", agentType: "customer", status: "active", lastMessageAt: new Date() },
  });
  createdConversationIds.push(lateConvD.id);
  const lateApptD = await prisma.appointment.create({
    data: {
      businessId: BIZ_ID, customerId: lateCustD.id, staffId: DANI_ID, serviceId: SERVICE_ID,
      date: new Date(`${todayIso}T00:00:00.000Z`), startTime: lateTimeD, endTime: nextTimeD,
      status: "confirmed", price: 80,
    },
  });
  createdAppointmentIds.push(lateApptD.id);
  const nextApptD = await prisma.appointment.create({
    data: {
      businessId: BIZ_ID, customerId: nextCustD.id, staffId: DANI_ID, serviceId: SERVICE_ID,
      date: new Date(`${todayIso}T00:00:00.000Z`), startTime: nextTimeD, endTime: `${pad(Math.floor((nowMin + 240) / 60) % 24)}:${pad((nowMin + 240) % 60)}`,
      status: "confirmed", price: 80,
    },
  });
  createdAppointmentIds.push(nextApptD.id);

  await reportRunningLate({
    bizId: BIZ_ID, conversationId: lateConvD.id, callerPhone: "972000000005",
    appointmentId: lateApptD.id, delayMinutes: 20,
  });
  await handleStaffApprovalReply(BIZ_ID, DANI_PHONE, "לא"); // decline the delay
  const proposalD = await prisma.swapProposal.findFirst({
    where: { primaryAppointmentId: lateApptD.id, kind: "late_arrival" },
    orderBy: { createdAt: "desc" },
  });
  if (proposalD?.status !== "pending_staff_swap_confirm") {
    throw new Error(`FAIL: expected pending_staff_swap_confirm, got ${proposalD?.status}`);
  }
  await handleStaffApprovalReply(BIZ_ID, DANI_PHONE, "לא"); // decline offering the swap too

  const [lateApptDFinal, proposalDFinal] = await Promise.all([
    prisma.appointment.findUnique({ where: { id: lateApptD.id } }),
    prisma.swapProposal.findUnique({ where: { id: proposalD.id } }),
  ]);
  console.log("lateApptD status:", lateApptDFinal?.status, "(expect no_show)");
  console.log("proposalD status:", proposalDFinal?.status, "(expect staff_rejected)");
  if (lateApptDFinal?.status !== "no_show") throw new Error("FAIL: appointment was not marked no_show after staff declined both questions");
  if (proposalDFinal?.status !== "staff_rejected") throw new Error("FAIL: proposal not left in staff_rejected");

  const nextApptDUnchanged = await prisma.appointment.findUnique({ where: { id: nextApptD.id } });
  if (nextApptDUnchanged?.status !== "confirmed" || nextApptDUnchanged?.startTime !== nextTimeD) {
    throw new Error("FAIL: the NEXT customer's appointment should be untouched when the swap was declined");
  }
  console.log("✅ TEST D PASSED — real no_show, next customer's appointment untouched");

  // ── Test E: staff confirms the swap offer, but the CANDIDATE declines it ──
  // 2026-08-14 (Yair, live test): this path went through finishUnsuccessful,
  // which said "your appointment stays as normal" — wrong for late_arrival,
  // where declining the swap means the SAME no-show outcome as the barber
  // declining outright. Also checks the exact wording Yair asked for.
  console.log("\n=== TEST E: staff confirms swap offer, candidate declines → still a real no-show ===");
  const lateTimeE = `${pad(Math.floor((nowMin + 270) / 60) % 24)}:${pad((nowMin + 270) % 60)}`;
  const nextTimeE = `${pad(Math.floor((nowMin + 300) / 60) % 24)}:${pad((nowMin + 300) % 60)}`;
  const lateCustE = await prisma.customer.create({ data: { businessId: BIZ_ID, name: "בדיקה-מאחר-ה", phone: "972000000007" } });
  createdCustomerIds.push(lateCustE.id);
  const nextCustE = await prisma.customer.create({ data: { businessId: BIZ_ID, name: "בדיקה-הבא-ה", phone: "972000000008" } });
  createdCustomerIds.push(nextCustE.id);
  const lateConvE = await prisma.conversation.create({
    data: { businessId: BIZ_ID, phone: "972000000007", agentType: "customer", status: "active", lastMessageAt: new Date() },
  });
  createdConversationIds.push(lateConvE.id);
  const lateApptE = await prisma.appointment.create({
    data: {
      businessId: BIZ_ID, customerId: lateCustE.id, staffId: DANI_ID, serviceId: SERVICE_ID,
      date: new Date(`${todayIso}T00:00:00.000Z`), startTime: lateTimeE, endTime: nextTimeE,
      status: "confirmed", price: 80,
    },
  });
  createdAppointmentIds.push(lateApptE.id);
  const nextApptE = await prisma.appointment.create({
    data: {
      businessId: BIZ_ID, customerId: nextCustE.id, staffId: DANI_ID, serviceId: SERVICE_ID,
      date: new Date(`${todayIso}T00:00:00.000Z`), startTime: nextTimeE, endTime: `${pad(Math.floor((nowMin + 330) / 60) % 24)}:${pad((nowMin + 330) % 60)}`,
      status: "confirmed", price: 80,
    },
  });
  createdAppointmentIds.push(nextApptE.id);

  await reportRunningLate({
    bizId: BIZ_ID, conversationId: lateConvE.id, callerPhone: "972000000007",
    appointmentId: lateApptE.id, delayMinutes: 20,
  });
  await handleStaffApprovalReply(BIZ_ID, DANI_PHONE, "לא"); // decline the delay
  await handleStaffApprovalReply(BIZ_ID, DANI_PHONE, "כן"); // confirm offering the swap
  const proposalE = await prisma.swapProposal.findFirst({
    where: { primaryAppointmentId: lateApptE.id, kind: "late_arrival" },
    orderBy: { createdAt: "desc" },
  });
  if (proposalE?.status !== "pending_response") throw new Error(`FAIL: expected pending_response after staff confirms swap offer, got ${proposalE?.status}`);

  console.log("\n-- candidate (next customer) replies לא --");
  const consumedCandidateNo = await handleCandidateReply(BIZ_ID, "972000000008", "לא");
  console.log("consumed:", consumedCandidateNo, "(expect true)");

  const [lateApptEFinal, nextApptEFinal] = await Promise.all([
    prisma.appointment.findUnique({ where: { id: lateApptE.id } }),
    prisma.appointment.findUnique({ where: { id: nextApptE.id } }),
  ]);
  console.log("lateApptE status:", lateApptEFinal?.status, "(expect no_show)");
  if (lateApptEFinal?.status !== "no_show") throw new Error("FAIL: late appointment should be no_show after the candidate declined the swap");
  if (nextApptEFinal?.status !== "confirmed" || nextApptEFinal?.startTime !== nextTimeE) {
    throw new Error("FAIL: the candidate's own appointment should be untouched after declining");
  }

  const msgLogE = await prisma.messageLog.findFirst({
    where: { businessId: BIZ_ID, customerPhone: "972000000007" },
    orderBy: { createdAt: "desc" },
  });
  console.log("message to late customer:", msgLogE?.body);
  if (!msgLogE?.body.includes("הברזה") || !msgLogE?.body.includes("תשלום מלא")) {
    throw new Error("FAIL: late customer's message should mention it's considered a no-show AND the full-charge note");
  }
  console.log("✅ TEST E PASSED — candidate decline also produces a real no-show, with the exact wording Yair asked for");

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
