/**
 * Calendar closure — live status, resend, manual-handled, escalation & summary.
 * ─────────────────────────────────────────────────────────────────────────────
 * One row per displaced customer:
 *   sent · rescheduled · agent (asked for something else, agent handling)
 *   · silent (no answer) · silent_escalated (barber was told to call)
 *   · manual (excluded / marked handled) · failed
 *
 * The sweep (`runClosureSweep`, piggybacked on the drip-queue tick) implements
 * the owner's rules (17.9.2026): no answer → resend after 1h, and again next day
 * 10:00; still silent AND (original appointment within 24h OR the day is over,
 * 20:00) → WhatsApp the CLOSING BARBER "call them"; when every customer is
 * handled → WhatsApp the closing barber a summary. Owner only sees the card.
 */
import { prisma } from "@/lib/prisma";
import { sendMessage, sendProactiveMessage } from "@/lib/messaging/index";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { getBusinessNow, timeToMinutes } from "@/lib/utils";
import { DEFAULT_CLOSURE_REMINDER_TEMPLATE, renderClosureText, describeSlot, rangeLabel, whenLabel } from "./message";

export type CustomerState = "sent" | "rescheduled" | "agent" | "silent" | "silent_escalated" | "manual" | "failed";
const END_OF_DAY_MIN = 20 * 60;
const RESEND_AFTER_MS = 60 * 60_000;
const NEXT_DAY_RESEND_MIN = 10 * 60;

export async function summarizeClosure(closureId: string) {
  const c = await prisma.calendarClosure.findUnique({ where: { id: closureId } });
  if (!c) return null;
  const staff = await prisma.staff.findUnique({ where: { id: c.staffId }, select: { name: true } });
  const appts = await prisma.appointment.findMany({
    where: { closureId }, orderBy: { startTime: "asc" },
    include: { customer: { select: { id: true, name: true, phone: true } }, service: { select: { name: true } }, staff: { select: { name: true } } },
  });
  await reconcileRebooked(c.id, c.createdAt, appts.map(a => ({ id: a.id, customerId: a.customer.id })));
  const proposals = await prisma.swapProposal.findMany({ where: { closureId } });
  const byAppt = new Map(proposals.map(p => [p.primaryAppointmentId, p]));
  const logs = await prisma.messageLog.findMany({
    where: { businessId: c.businessId, kind: { in: ["closure_notice", "closure_reminder", "closure_escalation"] }, appointmentId: { in: appts.map(a => a.id) } },
    select: { appointmentId: true, kind: true, status: true, createdAt: true },
  });
  const summary = JSON.parse(c.summaryJson || "{}") as { handled?: string[] };
  const handled = new Set(summary.handled ?? []);
  const rows = appts.map(a => {
    const p = byAppt.get(a.id);
    const mine = logs.filter(l => l.appointmentId === a.id);
    const notice = mine.find(l => l.kind === "closure_notice");
    const escalated = mine.some(l => l.kind === "closure_escalation");
    let state: CustomerState;
    let detail: string | null = null;
    if (handled.has(a.id) || !p) state = "manual";
    else if (p.status === "approved") { state = "rescheduled"; detail = p.targetDate ? describeSlot({ date: p.targetDate.toISOString().slice(0, 10), startTime: p.targetStartTime ?? "" }) : null; }
    else if (a.status === "confirmed" || a.status === "pending") { state = "rescheduled"; detail = describeSlot({ date: a.date.toISOString().slice(0, 10), startTime: a.startTime }); }
    else if (p.status === "rejected_by_customer" || p.status === "expired" || (p.status === "pending_response" && p.rawResponse)) state = "agent";
    else if (notice?.status === "failed") state = "failed";
    else if (escalated) state = "silent_escalated";
    else if (mine.some(l => l.kind === "closure_reminder")) state = "silent";
    else state = "sent";
    return {
      appointmentId: a.id, originalTime: a.startTime, customerName: a.customer.name, customerPhone: a.customer.phone,
      serviceName: a.service.name, state, detail,
      reminders: mine.filter(l => l.kind === "closure_reminder").length,
    };
  });
  const open = rows.filter(r => r.state === "sent" || r.state === "silent" || r.state === "silent_escalated" || r.state === "agent").length;
  return {
    id: c.id, staffId: c.staffId, staffName: staff?.name ?? "", date: c.date.toISOString().slice(0, 10),
    fromTime: c.fromTime, toTime: c.toTime, reason: c.reason, status: c.status, createdAt: c.createdAt,
    counts: { total: rows.length, open, rescheduled: rows.filter(r => r.state === "rescheduled").length,
      manual: rows.filter(r => r.state === "manual").length, silent: rows.filter(r => r.state.startsWith("silent")).length },
    customers: rows,
  };
}


/** A displaced customer who got a NEW appointment after the closure — booked by
 *  the agent in free text, or by the barber from the calendar — is done: close
 *  the proposal as approved (pointing at the new slot), free the held slots.
 *  Without this the card kept saying "בטיפול הסוכן" and the sweep would still
 *  count them as open (first real closure, 18.9.2026). */
async function reconcileRebooked(closureId: string, since: Date, appts: { id: string; customerId: string }[]) {
  const open = await prisma.swapProposal.findMany({
    where: { closureId, status: { in: ["pending_response", "expired", "rejected_by_customer"] } },
    select: { id: true, primaryAppointmentId: true },
  });
  if (!open.length) return;
  const custByAppt = new Map(appts.map(a => [a.id, a.customerId]));
  const todayStart = new Date(getBusinessNow().date + "T00:00:00.000Z");
  for (const p of open) {
    const customerId = custByAppt.get(p.primaryAppointmentId);
    if (!customerId) continue;
    const fresh = await prisma.appointment.findFirst({
      where: { customerId, id: { not: p.primaryAppointmentId }, createdAt: { gte: since }, date: { gte: todayStart }, status: { in: ["pending", "confirmed"] } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      select: { staffId: true, date: true, startTime: true },
    });
    if (!fresh) continue;
    await prisma.$transaction([
      prisma.swapProposal.update({ where: { id: p.id }, data: { status: "approved", approvedAt: new Date(), respondedAt: new Date(), targetStaffId: fresh.staffId, targetDate: fresh.date, targetStartTime: fresh.startTime } }),
      prisma.slotHold.deleteMany({ where: { proposalId: p.id } }),
    ]).catch(e => console.error("[closure] reconcile failed", e));
  }
}

export async function markHandled(closureId: string, appointmentId: string) {
  const c = await prisma.calendarClosure.findUnique({ where: { id: closureId } });
  if (!c) return;
  const s = JSON.parse(c.summaryJson || "{}") as { handled?: string[] };
  const handled = new Set(s.handled ?? []); handled.add(appointmentId);
  await prisma.calendarClosure.update({ where: { id: closureId }, data: { summaryJson: JSON.stringify({ ...s, handled: Array.from(handled) }) } });
  await prisma.swapProposal.updateMany({ where: { closureId, primaryAppointmentId: appointmentId, status: "pending_response" }, data: { status: "cancelled" } });
  await prisma.slotHold.deleteMany({ where: { proposalId: { in: (await prisma.swapProposal.findMany({ where: { closureId, primaryAppointmentId: appointmentId }, select: { id: true } })).map(p => p.id) } } });
}

/** Resend the notice as a reminder (barber's voice), keeping the same two options. */
export async function resendClosureNotice(closureId: string, appointmentId: string): Promise<boolean> {
  const p = await prisma.swapProposal.findFirst({
    where: { closureId, primaryAppointmentId: appointmentId, status: "pending_response" },
    include: { primary: { include: { customer: true, staff: true } } },
  });
  if (!p) return false;
  const opts = p.optionsJson ? JSON.parse(p.optionsJson) : [];
  const origDate = p.primary.date.toISOString().slice(0, 10);
  const text = renderClosureText(DEFAULT_CLOSURE_REMINDER_TEMPLATE, { name: p.primary.customer.name, barber: p.primary.staff.name, when: whenLabel(origDate, p.primary.startTime), options: opts, originalDate: origDate });
  try {
    await sendProactiveMessage({ businessId: p.businessId, customerPhone: p.primary.customer.phone, customerName: p.primary.customer.name,
      appointmentId, kind: "closure_reminder", body: text, escalate: false });
    await prisma.swapProposal.update({ where: { id: p.id }, data: { reminderSentAt: new Date() } });
    return true;
  } catch (e) { console.error("[closure] resend failed", e); return false; }
}

/** Piggybacked on the drip-queue tick. Idempotent; cheap when nothing is open. */
export async function runClosureSweep(now = new Date(), scope: { businessId?: string } = {}): Promise<{ resent: number; escalated: number; summarized: number }> {
  const out = { resent: 0, escalated: 0, summarized: 0 };
  const nowBiz = getBusinessNow();
  // `scope.businessId` exists for tests: an unscoped sweep from a test run once
  // nudged a REAL customer of another business (18.9.2026). The cron runs unscoped.
  const open = await prisma.calendarClosure.findMany({ where: { status: "active", ...(scope.businessId ? { businessId: scope.businessId } : {}) } });
  for (const c of open) {
    // Someone rebooked (agent / calendar) since the last tick → close their proposal first, never nag them.
    const appts = await prisma.appointment.findMany({ where: { closureId: c.id }, select: { id: true, customerId: true } });
    await reconcileRebooked(c.id, c.createdAt, appts);
    const pending = await prisma.swapProposal.findMany({
      where: { closureId: c.id, status: "pending_response", respondedAt: null, rawResponse: null },
      include: { primary: { include: { customer: true, staff: true } } },
    });
    for (const p of pending) {
      const ageMs = now.getTime() - p.createdAt.getTime();
      const sentDay = p.createdAt.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
      // 1) resend after 1h (once), then once more next day at 10:00
      if (!p.reminderSentAt && ageMs >= RESEND_AFTER_MS) { if (await resendClosureNotice(c.id, p.primaryAppointmentId)) out.resent++; continue; }
      const remDay = p.reminderSentAt?.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
      if (p.reminderSentAt && remDay === sentDay && nowBiz.date > sentDay && nowBiz.minutes >= NEXT_DAY_RESEND_MIN) {
        if (await resendClosureNotice(c.id, p.primaryAppointmentId)) out.resent++; continue;
      }
      // 2) still silent AND (original within 24h OR day over) → WhatsApp the closing barber, once
      if (!p.reminderSentAt) continue;
      const already = await prisma.messageLog.findFirst({ where: { appointmentId: p.primaryAppointmentId, kind: "closure_escalation" }, select: { id: true } });
      if (already) continue;
      const origMs = new Date(`${p.primary.date.toISOString().slice(0, 10)}T${p.primary.startTime}:00+03:00`).getTime();
      const within24h = origMs - now.getTime() <= 24 * 3600_000;
      const dayOver = nowBiz.date > sentDay || nowBiz.minutes >= END_OF_DAY_MIN;
      if (!(within24h || dayOver)) continue;
      const barberPhone = p.primary.staff.phone;
      if (!barberPhone) continue;
      const orig = describeSlot({ date: p.primary.date.toISOString().slice(0, 10), startTime: p.primary.startTime });
      await sendMessage({
        businessId: c.businessId, appointmentId: p.primaryAppointmentId, customerPhone: normalizeIsraeliPhone(barberPhone), kind: "closure_escalation",
        body: `${p.primary.customer.name} לא ענה על הביטול של התור ${orig} גם אחרי תזכורת — כדאי להתקשר אליו או לברר ישירות: ${p.primary.customer.phone}`,
      }).catch(e => console.error("[closure] escalation send failed", e));
      out.escalated++;
    }
    // 3) everyone handled → summary to the closing barber, once; closure resolved
    const s = await summarizeClosure(c.id);
    if (s && s.counts.open === 0 && !c.summarySentAt) {
      const staff = await prisma.staff.findUnique({ where: { id: c.staffId }, select: { phone: true, name: true } });
      const silent = s.customers.filter(r => r.state.startsWith("silent")).map(r => `${r.customerName} ${r.customerPhone}`).join(", ");
      const range = rangeLabel(c.fromTime, c.toTime);
      const body = `סיכום סגירה ${describeSlot({ date: s.date, startTime: "" }).replace(/ ב‑$/, "")} ${range}: ${s.counts.total} בוטלו — ${s.counts.rescheduled} נקבעו מחדש, ${s.counts.manual} בטיפול ידני שלך` + (silent ? `, לא ענו: ${silent}` : "") + ".";
      if (staff?.phone) await sendMessage({ businessId: c.businessId, customerPhone: normalizeIsraeliPhone(staff.phone), kind: "closure_summary", body }).catch(e => console.error("[closure] summary send failed", e));
      await prisma.calendarClosure.update({ where: { id: c.id }, data: { summarySentAt: now, status: "resolved", resolvedAt: now } });
      out.summarized++;
    }
  }
  return out;
}
