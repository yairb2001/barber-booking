/**
 * Customer-initiated cancellation — one implementation shared by the website
 * (/api/my-appointments/cancel), the WhatsApp "2" confirmation reply, and the
 * agent's cancel_appointment tool. Does NOT check ownership (callers verify
 * the phone) and does NOT reply to the customer on WhatsApp (callers pick the
 * wording); it does: past/policy guards, the status update, staff/owner
 * pushes, and the waitlist "slot opened" notification.
 */
import { prisma } from "@/lib/prisma";
import { getBusinessNow } from "@/lib/utils";
import { checkCancellationWindow, CANCELLATION_WINDOW_MESSAGE } from "@/lib/cancellation-policy";
import { notifyWaitlistForCancellation } from "@/lib/waitlist-notify";
import { pushToStaff, pushToOwner } from "@/lib/native/push";
import { notifyOwnerWeb, notifyStaffWeb } from "@/lib/native/web-push";

export type CancelResult =
  | { ok: true; alreadyCancelled?: boolean; dateLabel: string }
  | { ok: false; error: string };

export async function cancelByCustomer(appointmentId: string, opts: { skipPolicy?: boolean } = {}): Promise<CancelResult> {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { staff: true, customer: { select: { name: true, phone: true } } },
  });
  if (!appt) return { ok: false, error: "התור לא נמצא" };
  const dateLabel = appt.date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
  if (appt.status === "cancelled_by_customer" || appt.status === "cancelled_by_staff") return { ok: true, alreadyCancelled: true, dateLabel };

  const now = getBusinessNow();
  const aptDateStr = appt.date.toISOString().slice(0, 10);
  if (aptDateStr < now.date) return { ok: false, error: "לא ניתן לבטל תור שכבר עבר" };
  if (aptDateStr === now.date) {
    const [h, m] = appt.startTime.split(":").map(Number);
    if (h * 60 + m < now.minutes) return { ok: false, error: "לא ניתן לבטל תור שכבר עבר" };
  }
  if (!opts.skipPolicy) {
    const policy = await checkCancellationWindow({ businessId: appt.businessId, staffId: appt.staffId, apptDate: appt.date, startTime: appt.startTime, bookedAt: appt.createdAt });
    if (policy.blocked) return { ok: false, error: CANCELLATION_WINDOW_MESSAGE(policy.minHours) };
  }

  await prisma.appointment.update({ where: { id: appt.id }, data: { status: "cancelled_by_customer", cancelledAt: new Date() } });

  const barber = appt.staff?.name ?? "—";
  const title = "תור בוטל ע״י הלקוח ❌";
  const body = `${appt.customer?.name ?? "לקוח"} אצל ${barber}\n${dateLabel} בשעה ${appt.startTime}`;
  pushToStaff(appt.staffId, { title, body, data: { type: "appointment_cancelled", appointmentId: appt.id } }).catch(() => {});
  pushToOwner(appt.businessId, { title, body, data: { type: "appointment_cancelled", appointmentId: appt.id } }, appt.staffId).catch(() => {});
  notifyOwnerWeb(appt.businessId, "cancellation", { title, body, url: "/admin", tag: `cancel-${appt.id}` }, appt.staffId).catch(() => {});
  notifyStaffWeb(appt.staffId, "cancellation", { title, body, url: "/admin", tag: `cancel-${appt.id}` }).catch(() => {});

  await notifyWaitlistForCancellation({ businessId: appt.businessId, staffId: appt.staffId, date: appt.date, startTime: appt.startTime }).catch(console.error);
  return { ok: true, dateLabel };
}
