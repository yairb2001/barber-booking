// Requested by Tzachi (2026-09-19): a real number, not a synthetic test —
// how many real conversations hit "customer asked for a slot, none was
// available" in a given window, and in how many of those was the customer
// actually offered/registered for the waitlist afterward. Flagged as a
// possible direct revenue-loss gap (not just prompt polish) after the
// regression harness showed the "no slots -> waitlist offer" scenario
// passing only 60-90% at N=10 against synthetic scenarios.
//
// Detection is on the ACTUAL tool outputs (source of truth), not the
// model's self-report:
//   - no-slot signal: a get_available_slots/find_next_available tool
//     result matching the exact no-availability strings from
//     src/lib/agent/customer-agent.ts (execTool cases).
//   - waitlist-offered signal: EITHER an assistant message mentioning
//     "רשימת המתנה"/"רשימת ההמתנה" OR an actual join_waitlist tool call,
//     anywhere later in the same conversation (not just the next message —
//     the agent may keep trying other days/staff first).
//   - existing-appointment reschedule attempts (customer already had a
//     booking, asked to move it earlier, told no, kept the original) are
//     excluded from the gap count — not a lost new sale. Detected via the
//     Appointment table (resolving the customer by PHONE, not
//     Conversation.customerId — that field is null on plenty of real
//     conversations for customers who do exist on file, found by hand
//     while validating this script against real transcripts).
//
// Iterated against real transcripts before trusting the number: the first
// pass (waitlist-mention only) way overcounted "gaps" — it didn't credit a
// booking the agent found via find_next_available, and didn't recognize
// existing-appointment reschedule threads at all. Read ~8 real conversations
// by hand while building this; don't trust a single run of this script
// without spot-checking a few of its "gap" examples the same way.
//
//   node --env-file=.env scripts/check-waitlist-offer-rate.mjs [since] [until]
//   dates: YYYY-MM-DD. Defaults to 2026-09-01 .. 2026-09-19 (Yair's Sept 1-18 window).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BIZ = "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2"; // DOMINANT

const args = process.argv.slice(2);
const since = new Date(args[0] || "2026-09-01");
const until = new Date(args[1] || "2026-09-19");

const NO_SLOT_TOOLS = new Set(["get_available_slots", "find_next_available"]);
const NO_SLOT_PATTERN = /אין תורים פנויים|לא נמצאו תורים פנויים/;
const WAITLIST_MENTION = /רשימת ה?המתנה/;
const BOOK_SUCCESS = /✅\s*תור נקבע בהצלחה/;

async function main() {
  const convos = await prisma.conversation.findMany({
    where: { businessId: BIZ, agentType: "customer", lastMessageAt: { gte: since, lt: until } },
    select: { id: true, phone: true, whatsappName: true, customerId: true },
  });

  let hitNoSlot = 0;
  let existingApptReschedule = 0;
  let resolvedByBooking = 0;
  let resolvedByWaitlist = 0;
  let unresolvedGap = 0;
  const gapExamples = [];

  for (const c of convos) {
    const msgs = await prisma.conversationMessage.findMany({
      where: { conversationId: c.id },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true, toolName: true, createdAt: true },
    });

    const noSlotIdx = msgs.findIndex(
      m => m.role === "tool" && NO_SLOT_TOOLS.has(m.toolName ?? "") && NO_SLOT_PATTERN.test(m.content)
    );
    if (noSlotIdx === -1) continue;

    hitNoSlot++;
    const noSlotAt = msgs[noSlotIdx].createdAt;

    // Existing-appointment reschedule attempt (customer already has a booking,
    // asked to move it earlier, told no, kept their original appointment) is
    // NOT a lost sale — they already had one. Detected against the Appointment
    // table directly (more reliable than inferring from which tool fired,
    // which spot-checking showed some real reschedule threads skip): did this
    // customer already have a non-cancelled appointment, booked before this
    // "no slots" moment, for a date still in the future at that moment?
    let hadExistingAppt = false;
    // Conversation.customerId is only populated "once identified" per the
    // schema comment — it's null on plenty of real conversations for
    // customers who DO exist (found by hand: Or Siboni had customerId=null
    // on the conversation despite an active appointment on file). Resolve via
    // phone instead of trusting the conversation's own link.
    const customer = await prisma.customer.findFirst({ where: { businessId: BIZ, phone: c.phone }, select: { id: true } });
    if (customer) {
      // Appointment.date is a date-only value (midnight), while noSlotAt has a
      // real time-of-day — comparing them directly would wrongly exclude a
      // same-day appointment later that day (midnight < 09:56, say). Compare
      // against the START of the no-slot moment's day instead.
      const noSlotDayStart = new Date(Date.UTC(noSlotAt.getUTCFullYear(), noSlotAt.getUTCMonth(), noSlotAt.getUTCDate()));
      const existing = await prisma.appointment.findFirst({
        where: {
          customerId: customer.id,
          businessId: BIZ,
          status: { notIn: ["cancelled_by_customer", "cancelled_by_staff"] },
          createdAt: { lt: noSlotAt },
          date: { gte: noSlotDayStart },
        },
        select: { id: true },
      });
      hadExistingAppt = !!existing;
    }
    if (hadExistingAppt) {
      existingApptReschedule++;
      continue;
    }

    const after = msgs.slice(noSlotIdx + 1);
    // Classify by what ACTUALLY happened next, not just "did the model mention
    // the word waitlist" — a customer who got booked into an alternative slot
    // the agent found (find_next_available -> accepted) is a SUCCESS, not a
    // gap, even though a "no slots" tool result appeared earlier in the same
    // conversation. Only count it as a real gap if neither a booking nor a
    // waitlist registration/offer followed.
    const booked = after.some(m => m.role === "tool" && m.toolName === "book_appointment" && BOOK_SUCCESS.test(m.content));
    const waitlisted = after.some(
      m => (m.role === "assistant" && WAITLIST_MENTION.test(m.content)) || (m.role === "tool" && m.toolName === "join_waitlist")
    );

    if (booked) resolvedByBooking++;
    else if (waitlisted) resolvedByWaitlist++;
    else {
      unresolvedGap++;
      gapExamples.push({ conv: `${c.whatsappName || "—"} (${c.phone}) [${c.id.slice(0, 8)}]`, at: msgs[noSlotIdx].createdAt.toISOString() });
    }
  }

  console.log(`\n📋 "אין תורים פנויים" — מה קרה בפועל אחר כך — ${since.toISOString().slice(0, 10)} עד ${until.toISOString().slice(0, 10)}\n`);
  console.log(`שיחות נבדקו (agentType=customer, נגעו בתקופה): ${convos.length}`);
  console.log(`שיחות שהגיעו ל"אין תורים פנויים" בפועל: ${hitNoSlot}`);
  console.log(`  → ניסיון להזיז תור קיים (כבר היה לו תור) — לא אובדן לקוח חדש: ${existingApptReschedule}`);
  console.log(`  → נפתר בקביעת תור אחר (find_next_available/יום אחר וכו') בהמשך אותה שיחה: ${resolvedByBooking}`);
  console.log(`  → נפתר בהצעת/רישום לרשימת המתנה: ${resolvedByWaitlist}`);
  const newBookingAttempts = hitNoSlot - existingApptReschedule;
  console.log(`  → פער אמיתי (מתוך ${newBookingAttempts} ניסיונות תור חדש בפועל) — לא תור, לא רשימת המתנה: ${unresolvedGap} (${newBookingAttempts ? ((unresolvedGap / newBookingAttempts) * 100).toFixed(0) : 0}%)`);

  if (gapExamples.length) {
    console.log(`\nשיחות עם פער אמיתי (${gapExamples.length}):`);
    for (const e of gapExamples) console.log(`  - ${e.conv} — ${e.at}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
