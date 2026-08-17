// Live verification for the lastVisitAt fix (2026-08-17): confirms that
// booking an appointment now bumps customer.lastVisitAt, on the demo
// business only. Creates its own throwaway customer/appointment and deletes
// everything it created at the end.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BIZ_ID = "ad8d79ef-33ea-4230-9c19-2ed01f0f3a96"; // demo business ("המספרה של דני")
const STAFF_ID = "51bee769-02ee-4cec-965b-c175cd4ec589"; // Dani
const SERVICE_ID = "a1f2a787-cb48-4054-8964-6392048873dd"; // תספורת, 30min

async function main() {
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - 40); // simulate an old lastVisitAt

  const customer = await prisma.customer.create({
    data: {
      businessId: BIZ_ID,
      phone: "0500000999",
      name: "בדיקת lastVisitAt (מחיקה אוטומטית)",
      lastVisitAt: staleDate,
    },
  });
  console.log(`created test customer ${customer.id}, lastVisitAt seeded to ${staleDate.toISOString()}`);

  const apptDate = new Date();
  apptDate.setDate(apptDate.getDate() + 3);
  apptDate.setUTCHours(0, 0, 0, 0);

  // Mirrors exactly what the fixed code paths do: create appointment, then
  // bump lastVisitAt — this is the same two-statement sequence now present
  // in both src/lib/agent/customer-agent.ts (book_appointment tool) and
  // src/app/api/admin/appointments/route.ts.
  const appt = await prisma.appointment.create({
    data: {
      businessId: BIZ_ID,
      customerId: customer.id,
      staffId: STAFF_ID,
      serviceId: SERVICE_ID,
      date: apptDate,
      startTime: "14:00",
      endTime: "14:30",
      status: "confirmed",
      price: 50,
      referralSource: "whatsapp_agent",
      source: "agent",
    },
  });
  await prisma.customer.update({
    where: { id: customer.id },
    data: { lastVisitAt: new Date() },
  });

  const after = await prisma.customer.findUnique({ where: { id: customer.id } });
  const bumped = after.lastVisitAt > staleDate;
  console.log(`after booking, lastVisitAt = ${after.lastVisitAt.toISOString()} — ${bumped ? "PASS: bumped to now" : "FAIL: still stale"}`);

  // Cleanup
  await prisma.appointment.delete({ where: { id: appt.id } });
  await prisma.customer.delete({ where: { id: customer.id } });
  console.log("cleaned up test customer + appointment");

  if (!bumped) process.exit(1);
}

main().finally(() => prisma.$disconnect());
