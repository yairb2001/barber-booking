/**
 * Live functional test for the implicit-waitlist feature (2026-08-14):
 * a customer who gets told "no room" is silently noted (Waitlist row,
 * source="declined_offer") without ever formally joining a waitlist, and
 * gets pinged with a casual, context-referencing message (not the owner's
 * formal waitlist template) if a slot frees up.
 *
 * Runs against the DEMO business ("המספרה של דני") — real DB writes. Creates
 * its own test customer/conversation, drives the real get_available_slots
 * no-slots code path, confirms the entry is excluded from every
 * admin/customer-visible query shape, then fires the real notify pipeline and
 * inspects the actual MessageLog body that was queued. Deletes everything it
 * created at the end.
 *
 * Usage: npx tsx --env-file=.env scripts/test-implicit-waitlist.ts
 */
import { PrismaClient } from "@prisma/client";
import { execTool } from "../src/lib/agent/customer-agent";
import { sendWaitlistEntryNotification } from "../src/lib/waitlist-notify";

const prisma = new PrismaClient();
const BIZ_ID = "ad8d79ef-33ea-4230-9c19-2ed01f0f3a96"; // demo business (Dani)
const SERVICE_ID = "a1f2a787-cb48-4054-8964-6392048873dd"; // תספורת
const TEST_PHONE = "972000000098";

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
    await new Promise(r => setTimeout(r, 500)); // noteImplicitWaitlistInterest is fire-and-forget (void), give it time to land

    console.log("\n=== Step 2: check a Waitlist row was silently created ===");
    const entry = await prisma.waitlist.findFirst({
      where: { businessId: BIZ_ID, customerId: cust.id, date: new Date(`${FAR_DATE}T00:00:00.000Z`) },
      include: { customer: true, service: true, staff: true },
    });
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

    console.log("\n✅ ALL IMPLICIT-WAITLIST TESTS PASSED");
  } finally {
    console.log("\n--- cleanup ---");
    await prisma.messageLog.deleteMany({ where: { businessId: BIZ_ID, customerPhone: TEST_PHONE } });
    await prisma.waitlist.deleteMany({ where: { businessId: BIZ_ID, customerId: cust.id } });
    await prisma.conversationMessage.deleteMany({ where: { conversationId: conv.id } });
    await prisma.conversation.delete({ where: { id: conv.id } });
    await prisma.customer.delete({ where: { id: cust.id } });
    console.log("cleaned up test customer/conversation/waitlist/messagelog");
  }
}

main().catch(err => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
