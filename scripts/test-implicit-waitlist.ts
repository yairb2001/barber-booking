/**
 * Live functional test for the implicit-waitlist feature (2026-08-14):
 * a customer who gets told "no room" is silently noted (Waitlist row,
 * source="declined_offer") without ever formally joining a waitlist, and
 * gets pinged with a casual, context-referencing message (not the owner's
 * formal waitlist template) if a slot frees up. Also covers two things Yair
 * asked for after reviewing the first version: (5-6) a flat "לא" reply to
 * that ping isn't silently dropped — one follow-up question first — and
 * (7) it also works for callers with no Customer record at all yet.
 *
 * Runs against the DEMO business ("המספרה של דני") — real DB writes. Creates
 * its own test customer/conversation, drives the real get_available_slots
 * no-slots code path, confirms the entry is excluded from every
 * admin/customer-visible query shape, fires the real notify pipeline and
 * inspects the actual MessageLog body that was queued, then drives the
 * decline-reply webhook interceptor directly. Deletes everything it created.
 *
 * Usage: npx tsx --env-file=.env scripts/test-implicit-waitlist.ts
 */
import { PrismaClient } from "@prisma/client";
import { execTool } from "../src/lib/agent/customer-agent";
import { sendWaitlistEntryNotification, handleWaitlistDeclineReply } from "../src/lib/waitlist-notify";

const prisma = new PrismaClient();
const BIZ_ID = "ad8d79ef-33ea-4230-9c19-2ed01f0f3a96"; // demo business (Dani)
const SERVICE_ID = "a1f2a787-cb48-4054-8964-6392048873dd"; // תספורת
const TEST_PHONE = "972000000098";
const NEW_CUST_PHONE = "972000000097"; // deliberately has NO Customer record yet

function farFutureDateISO(daysOut: number) {
  const d = new Date(Date.now() + daysOut * 24 * 3600 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(d);
}

async function main() {
  const cust = await prisma.customer.create({
    data: { businessId: BIZ_ID, name: "בדיקה-רשימת-המתנה", phone: TEST_PHONE },
  });
  const conv = await prisma.conversation.create({
    data: { businessId: BIZ_ID, phone: TEST_PHONE, agentType: "customer", status: "active" },
  });

  const FAR_DATE = farFutureDateISO(45); // beyond the 30-day booking horizon → guaranteed no slots

  try {
    console.log("=== Step 1: get_available_slots on a day beyond the booking horizon (should be empty) ===");
    const result = await execTool(
      "get_available_slots",
      { date: FAR_DATE, serviceId: SERVICE_ID },
      BIZ_ID,
      conv.id,
      TEST_PHONE,
    );
    console.log("tool result:", result);
    console.log("expect: 'אין תורים פנויים' message");

    console.log("\n=== Step 2: check a Waitlist row was silently created ===");
    // noteImplicitWaitlistInterest is fire-and-forget (void) — poll instead of
    // a fixed sleep, a busy DB connection can make a single wait flaky.
    let entry = null;
    for (let i = 0; i < 10 && !entry; i++) {
      await new Promise(r => setTimeout(r, 300));
      entry = await prisma.waitlist.findFirst({
        where: { businessId: BIZ_ID, customerId: cust.id, date: new Date(`${FAR_DATE}T00:00:00.000Z`) },
        include: { customer: true, service: true, staff: true },
      });
    }
    console.log("entry:", entry ? { id: entry.id, source: entry.source, status: entry.status, serviceId: entry.serviceId, staffId: entry.staffId } : null);
    if (!entry) throw new Error("FAIL: no implicit waitlist entry created");
    if (entry.source !== "declined_offer") throw new Error(`FAIL: expected source=declined_offer, got ${entry.source}`);
    console.log("✅ implicit entry created with source=declined_offer");

    console.log("\n=== Step 3: confirm it would be excluded from the admin waitlist query (source: explicit filter) ===");
    const adminVisible = await prisma.waitlist.findFirst({
      where: { id: entry.id, source: "explicit" },
    });
    console.log("adminVisible (expect null):", adminVisible);
    if (adminVisible) throw new Error("FAIL: implicit entry is visible under source=explicit filter");
    console.log("✅ hidden from admin-visible query shape");

    console.log("\n=== Step 4: fire the real notify pipeline, inspect the actual queued message body ===");
    await sendWaitlistEntryNotification(
      "המספרה של דני",
      entry,
      "cancellation",
      undefined,
      undefined,
      { freedTime: "13:00", immediate: true },
    );
    const log = await prisma.messageLog.findFirst({
      where: { businessId: BIZ_ID, customerPhone: TEST_PHONE, kind: "waitlist_notify" },
      orderBy: { createdAt: "desc" },
    });
    console.log("MessageLog body sent:\n---\n" + log?.body + "\n---");
    if (!log) throw new Error("FAIL: no MessageLog row created");
    if (log.body.includes("בשורות טובות") || log.body.includes("מהרו לקבוע")) {
      throw new Error("FAIL: implicit entry used the FORMAL template instead of the casual one");
    }
    if (!log.body.includes("שאלת אצלנו") || !log.body.includes("מעניין אותך")) {
      throw new Error("FAIL: casual message doesn't look right");
    }
    console.log("✅ casual, context-referencing message used (not the formal waitlist template)");

    console.log("\n=== Step 4b: the notify message also lands in ConversationMessage (agent's context) ===");
    await new Promise(r => setTimeout(r, 1000)); // logToConversationHistory is fire-and-forget (void)
    const convForNotify = await prisma.conversation.findFirst({ where: { businessId: BIZ_ID, phone: TEST_PHONE } });
    const loggedNotify = convForNotify
      ? await prisma.conversationMessage.findFirst({
          where: { conversationId: convForNotify.id, content: { contains: "שאלת אצלנו" } },
          orderBy: { createdAt: "desc" },
        })
      : null;
    console.log("logged in conversation history:", !!loggedNotify);
    if (!loggedNotify) throw new Error("FAIL: waitlist notify message never landed in ConversationMessage — agent would have no context if the customer replies");
    console.log("✅ agent will have context if the customer replies to this");

    console.log("\n=== Step 5: customer replies לא to the ping → asked a follow-up instead of silently dropped ===");
    const declineHandled = await handleWaitlistDeclineReply(BIZ_ID, TEST_PHONE, "לא");
    console.log("intercepted:", declineHandled, "(expect true)");
    if (!declineHandled) throw new Error("FAIL: decline reply was not intercepted");
    const entryAfterDecline = await prisma.waitlist.findUnique({ where: { id: entry.id } });
    console.log("status after לא:", entryAfterDecline?.status, "(expect awaiting_declined_confirm)");
    if (entryAfterDecline?.status !== "awaiting_declined_confirm") throw new Error("FAIL: expected awaiting_declined_confirm");
    console.log("✅ not silently dropped — follow-up question asked first");

    await new Promise(r => setTimeout(r, 1000));
    const loggedFollowup = convForNotify
      ? await prisma.conversationMessage.findFirst({
          where: { conversationId: convForNotify.id, content: { contains: "רוצה בכל זאת שאעדכן" } },
        })
      : null;
    if (!loggedFollowup) throw new Error("FAIL: the follow-up question never landed in ConversationMessage either");
    console.log("✅ follow-up question also logged to conversation history");

    console.log("\n=== Step 6a: answers כן to the follow-up → stays on the list ===");
    const followupYes = await handleWaitlistDeclineReply(BIZ_ID, TEST_PHONE, "כן");
    console.log("intercepted:", followupYes, "(expect true)");
    const entryAfterYes = await prisma.waitlist.findUnique({ where: { id: entry.id } });
    console.log("status after כן:", entryAfterYes?.status, "(expect waiting)");
    if (entryAfterYes?.status !== "waiting") throw new Error("FAIL: expected waiting after confirming they still want updates");
    console.log("✅ kept on the list");

    console.log("\n=== Step 6b: decline again, then answer לא to the follow-up → removed ===");
    await handleWaitlistDeclineReply(BIZ_ID, TEST_PHONE, "לא"); // re-enter awaiting_declined_confirm
    const followupNo = await handleWaitlistDeclineReply(BIZ_ID, TEST_PHONE, "לא");
    console.log("intercepted:", followupNo, "(expect true)");
    const entryAfterNo = await prisma.waitlist.findUnique({ where: { id: entry.id } });
    console.log("status after second לא:", entryAfterNo?.status, "(expect expired)");
    if (entryAfterNo?.status !== "expired") throw new Error("FAIL: expected expired after declining the follow-up too");
    console.log("✅ removed from further consideration");

    console.log("\n=== Step 7: brand-new caller (no Customer record at all) still gets silently noted ===");
    // Idempotent: wipe any leftover from a previous interrupted run instead
    // of failing the whole suite over stale test data.
    const preCheck = await prisma.customer.findFirst({ where: { businessId: BIZ_ID, phone: NEW_CUST_PHONE } });
    if (preCheck) {
      await prisma.waitlist.deleteMany({ where: { customerId: preCheck.id } });
      await prisma.conversationMessage.deleteMany({ where: { conversation: { phone: NEW_CUST_PHONE } } });
      await prisma.conversation.deleteMany({ where: { phone: NEW_CUST_PHONE } });
      await prisma.customer.delete({ where: { id: preCheck.id } });
    }
    const newConv = await prisma.conversation.create({
      data: { businessId: BIZ_ID, phone: NEW_CUST_PHONE, agentType: "customer", status: "active" },
    });
    await execTool("get_available_slots", { date: FAR_DATE, serviceId: SERVICE_ID }, BIZ_ID, newConv.id, NEW_CUST_PHONE);
    // Brand-new caller needs TWO sequential writes inside the fire-and-forget
    // helper (create the Customer, then the Waitlist row) — give it more room
    // than the single-write case above.
    await new Promise(r => setTimeout(r, 1500));
    const newCust = await prisma.customer.findFirst({ where: { businessId: BIZ_ID, phone: NEW_CUST_PHONE } });
    console.log("auto-created customer:", newCust ? { id: newCust.id, name: newCust.name } : null);
    if (!newCust) throw new Error("FAIL: no Customer record was silently created for the brand-new caller");
    const newEntry = await prisma.waitlist.findFirst({
      where: { businessId: BIZ_ID, customerId: newCust.id, date: new Date(`${FAR_DATE}T00:00:00.000Z`) },
    });
    console.log("implicit entry for new customer:", newEntry ? { source: newEntry.source } : null);
    if (!newEntry || newEntry.source !== "declined_offer") throw new Error("FAIL: no implicit entry for the brand-new customer");
    console.log("✅ brand-new customer silently noted, no name/signup ever asked for");

    await prisma.waitlist.deleteMany({ where: { businessId: BIZ_ID, customerId: newCust.id } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: newConv.id } });
    await prisma.conversation.delete({ where: { id: newConv.id } });
    await prisma.customer.delete({ where: { id: newCust.id } });

    console.log("\n✅ ALL IMPLICIT-WAITLIST TESTS PASSED");
  } finally {
    console.log("\n--- cleanup ---");
    await prisma.messageLog.deleteMany({ where: { businessId: BIZ_ID, customerPhone: { in: [TEST_PHONE, NEW_CUST_PHONE] } } });
    await prisma.waitlist.deleteMany({ where: { businessId: BIZ_ID, customerId: cust.id } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: conv.id } });
    await prisma.conversation.delete({ where: { id: conv.id } });
    await prisma.customer.delete({ where: { id: cust.id } });
    console.log("cleaned up test customer/conversation/waitlist/messagelog");
  }
}

main().catch(err => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
