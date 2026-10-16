/**
 * POST /api/my-appointments/move
 *
 * Customer-initiated reschedule of ONE upcoming appointment — same barber,
 * same service, a new date/time the customer picked from /api/slots.
 * Body: { appointmentId, phone, token, date: "YYYY-MM-DD", startTime: "HH:MM" }
 *   - token is the OTP JWT issued by /api/otp/verify (type "otp")
 *   - the appointment must belong to the customer whose phone matches the token
 *
 * Applies the same minimum-notice policy as cancelling (a move IS a cancel of
 * the old slot), re-checks the new slot against live availability, updates
 * the row in place (id stays the same, so reminders keyed by appointmentId
 * are re-scheduled), tells the waitlist the OLD slot opened up, pushes the
 * barber/owner, and sends the customer the "appointment moved" message.
 */
import { NextRequest, NextResponse } from "next/server";
import { writeChecked, SlotRefused } from "@/lib/availability/guard";
import { shapeOfBooking } from "@/lib/availability/shape";
import { shapeLength } from "@/lib/availability/engine";
import { authSecret } from "@/lib/jwt-secret";
import { prisma } from "@/lib/prisma";
import { refreshReminders } from "@/lib/reminders-sweep";
import { jwtVerify } from "jose";
import { notifyWaitlistForCancellation } from "@/lib/waitlist-notify";
import { pushToStaff, pushToOwner } from "@/lib/native/push";
import { notifyOwnerWeb, notifyStaffWeb } from "@/lib/native/web-push";
import { sendMessage, appointmentMovedText } from "@/lib/messaging";
import { checkCancellationWindow, CANCELLATION_WINDOW_MESSAGE } from "@/lib/cancellation-policy";
import { timeToMinutes, minutesToTime, getBusinessNow } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { appointmentId, phone, token, date, startTime } = body as Record<string, string | undefined>;
  if (!appointmentId || !phone || !token || !date || !startTime) {
    return NextResponse.json({ error: "appointmentId, phone, token, date, startTime required" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime)) {
    return NextResponse.json({ error: "bad date/time" }, { status: 400 });
  }
  const normalized = phone.replace(/\D/g, "").replace(/^0/, "972");

  let tokenPayload: { phone?: unknown; type?: unknown } = {};
  try { tokenPayload = (await jwtVerify(token, authSecret())).payload as typeof tokenPayload; }
  catch { return NextResponse.json({ error: "פג תוקף הסשן — יש להתחבר מחדש" }, { status: 401 }); }
  if (tokenPayload.type !== "otp" || tokenPayload.phone !== normalized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { customer: { select: { name: true, phone: true } }, staff: { select: { name: true } }, service: { select: { name: true, durationMinutes: true } }, business: true },
  });
  if (!appt) return NextResponse.json({ error: "התור לא נמצא" }, { status: 404 });
  const custNorm = (appt.customer?.phone ?? "").replace(/\D/g, "").replace(/^0/, "972");
  if (custNorm !== normalized) return NextResponse.json({ error: "אין הרשאה לשנות תור זה" }, { status: 403 });
  if (!["pending", "confirmed"].includes(appt.status)) return NextResponse.json({ error: "התור כבר לא פעיל" }, { status: 400 });

  // The old slot must still be in the future, and within the notice policy.
  const nowBiz = getBusinessNow();
  const oldDateStr = appt.date.toISOString().slice(0, 10);
  if (oldDateStr < nowBiz.date || (oldDateStr === nowBiz.date && timeToMinutes(appt.startTime) < nowBiz.minutes)) {
    return NextResponse.json({ error: "לא ניתן להזיז תור שכבר עבר" }, { status: 400 });
  }
  const policy = await checkCancellationWindow({ businessId: appt.businessId, staffId: appt.staffId, apptDate: appt.date, startTime: appt.startTime, bookedAt: appt.createdAt });
  if (policy.blocked) return NextResponse.json({ error: CANCELLATION_WINDOW_MESSAGE(policy.minHours) }, { status: 400 });

  // The new time must be genuinely bookable — working hours, breaks, horizon,
  // lead time, other bookings by their real busy parts, live holds — with this
  // appointment's own current slot not counting against it, and its own
  // length and shape as booked (not the service's base length).
  const shape = shapeOfBooking(appt);
  const oldDate = appt.date, oldStart = appt.startTime;
  const newDate = new Date(date + "T00:00:00.000Z");
  const endTime = minutesToTime(timeToMinutes(startTime) + shapeLength(shape));
  const check = { staffId: appt.staffId, dateISO: date, startTime, shape, ignoreAppointmentIds: [appt.id], holds: { exemptCustomerId: appt.customerId }, customer: { leadGraceMinutes: 15 }, room: { businessId: appt.businessId, serviceId: appt.serviceId } };
  try {
    await writeChecked([check], (tx, rooms) => tx.appointment.update({ where: { id: appt.id }, data: { date: newDate, startTime, endTime, confirmedAt: null, roomId: rooms[0] } }));
  } catch (e) {
    if (e instanceof SlotRefused) return NextResponse.json({ error: "השעה הזו כבר לא פנויה — בחר שעה אחרת", slotTaken: true }, { status: 409 });
    throw e;
  }

  // Reminders were enqueued for the OLD time — drop the ones not yet sent so the
  // sweep re-creates them for the new time.
  await refreshReminders([appt.id]);

  const fmt = (d: Date) => d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const oldLabel = fmt(oldDate), newLabel = fmt(newDate);
  const title = "לקוח הזיז תור 🔄";
  const pushBody = `${appt.customer?.name ?? "לקוח"} אצל ${appt.staff.name}\n${oldLabel} ${oldStart} ← ${newLabel} ${startTime}`;
  pushToStaff(appt.staffId, { title, body: pushBody, data: { type: "appointment_moved", appointmentId: appt.id } }).catch(() => {});
  pushToOwner(appt.businessId, { title, body: pushBody, data: { type: "appointment_moved", appointmentId: appt.id } }, appt.staffId).catch(() => {});
  notifyOwnerWeb(appt.businessId, "appointment", { title, body: pushBody, url: "/admin", tag: `move-${appt.id}` }, appt.staffId).catch(() => {});
  notifyStaffWeb(appt.staffId, "appointment", { title, body: pushBody, url: "/admin", tag: `move-${appt.id}` }).catch(() => {});

  await notifyWaitlistForCancellation({ businessId: appt.businessId, staffId: appt.staffId, date: oldDate, startTime: oldStart }).catch(console.error);

  if (appt.customer?.phone) {
    const msg = appointmentMovedText({
      customerName: appt.customer.name, businessName: appt.business.name,
      newDateLabel: newLabel, newTime: startTime, newStaffName: appt.staff.name, serviceName: appt.service.name,
    }, appt.business.appointmentMovedTemplate);
    await sendMessage({ businessId: appt.businessId, appointmentId: appt.id, customerPhone: appt.customer.phone, kind: "appointment_moved", body: msg }).catch(console.error);
  }

  return NextResponse.json({ ok: true, date, startTime, endTime });
}
