/**
 * Appointment confirmations ("reply 1 to confirm, 2 to cancel").
 *
 * OFF by default. The owner turns it on in settings (Business.settings
 * .apptConfirmations = true). When on:
 *   • the 24h reminder ends with a one-line ask (below);
 *   • a booking made less than ~27h before the appointment gets the same ask on
 *     its confirmation message (the 24h reminder would never reach it);
 *   • the WhatsApp webhook handles a bare "1" / "2" reply in pure code —
 *     no agent involved — and stamps Appointment.confirmedAt / cancels;
 *   • the calendar draws unconfirmed upcoming appointments with a dashed
 *     border so tomorrow's "sure / not sure" is visible at a glance.
 */

export const CONFIRM_ASK_LINE = "לאישור התור השב 1 · לביטול השב 2";

export function confirmationsEnabled(settingsRaw: string | null | undefined): boolean {
  try {
    const s = settingsRaw ? JSON.parse(settingsRaw) : {};
    return s.apptConfirmations === true;
  } catch { return false; }
}

/** Append the ask line unless the body already carries it. */
export function withConfirmAsk(body: string): string {
  if (body.includes(CONFIRM_ASK_LINE)) return body;
  return body.trimEnd() + "\n\n" + CONFIRM_ASK_LINE;
}

/** Parse a customer reply. Returns "confirm" | "cancel" | null. */
export function parseConfirmReply(text: string): "confirm" | "cancel" | null {
  const t = text.trim().replace(/[.\s!]+$/g, "");
  if (t === "1" || t === "מאשר" || t === "מאשרת" || t === "אישור") return "confirm";
  if (t === "2") return "cancel";
  return null;
}

// ── Server-side reply handler (called from the WhatsApp webhook) ─────────────
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { cancelByCustomer } from "@/lib/appointments/cancel-by-customer";
import { phoneVariants } from "@/lib/messaging/phone";

/**
 * If confirmations are on for this business and the message is a bare "1"/"2",
 * act on the customer's next appointment in the coming 48h and reply. Returns
 * true when the message was consumed (the agent must not run).
 */
export async function handleConfirmReply(biz: { id: string; settings: string | null }, phone: string, text: string): Promise<boolean> {
  if (!confirmationsEnabled(biz.settings)) return false;
  const action = parseConfirmReply(text);
  if (!action) return false;

  const now = new Date();
  const dayStart = new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const dayEnd = new Date(dayStart.getTime() + 2 * 86_400_000 - 1);
  const appt = await prisma.appointment.findFirst({
    where: {
      businessId: biz.id,
      status: { in: ["pending", "confirmed"] },
      date: { gte: dayStart, lte: dayEnd },
      customer: { phone: { in: phoneVariants(phone) } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    include: { staff: { select: { name: true } }, customer: { select: { name: true, phone: true } } },
  });
  if (!appt) return false; // nothing to confirm → let the agent answer normally

  const dateLabel = appt.date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";

  if (action === "confirm") {
    if (!appt.confirmedAt) await prisma.appointment.update({ where: { id: appt.id }, data: { confirmedAt: now } });
    await sendMessage({
      businessId: biz.id, appointmentId: appt.id, customerPhone: appt.customer.phone, kind: "manual",
      body: `תודה! התור שלך ב${dateLabel} בשעה ${appt.startTime} אצל ${appt.staff.name} מאושר ✔\nנתראה!`,
    });
    return true;
  }

  const res = await cancelByCustomer(appt.id);
  const body = res.ok
    ? `התור שלך ב${dateLabel} בשעה ${appt.startTime} בוטל.\nלקביעת תור חדש: ${baseUrl}/book`
    : `${res.error}.\nאפשר לדבר איתנו כאן ונסדר את זה.`;
  await sendMessage({ businessId: biz.id, appointmentId: appt.id, customerPhone: appt.customer.phone, kind: res.ok ? "appointment_cancelled" : "manual", body });
  return true;
}
