/**
 * Calendar closure — execution (writes).
 * ──────────────────────────────────────
 * Turns an approved plan into: the closure row + the schedule override, the
 * cancellations (WITHOUT the "a slot freed up" waitlist blast — the day is
 * closed), one SwapProposal per customer carrying TWO alternatives, a SlotHold
 * per alternative, and the notice in the barber's voice — sent immediately,
 * nearest appointment first. Spec: specs/calendar-closure.md §3.4
 */
import { prisma } from "@/lib/prisma";
import { sendProactiveMessage } from "@/lib/messaging/index";
import { timeToMinutes, minutesToTime } from "@/lib/utils";
import { planClosure, type ClosureInput, type ClosurePlan, type SlotOption } from "./plan";
import { DEFAULT_CLOSURE_NOTICE_TEMPLATE, renderClosureText, describeSlot } from "./message";

export const HOLD_HOURS = 24;

export type ExecuteOptions = {
  reason?: string | null;
  createdByStaffId?: string | null;
  /** appointmentIds the barber chose to handle himself — cancelled, no notice */
  excludeAppointmentIds?: string[];
  /** per-appointment custom wording (already rendered by the wizard, no placeholders) */
  customTextByAppointmentId?: Record<string, string>;
  /** override the default template for everyone (may still contain {{placeholders}}) */
  templateOverride?: string | null;
};

export type ExecuteResult = {
  closureId: string;
  sent: number; excluded: number; failed: number;
  perCustomer: { appointmentId: string; customerName: string; state: "sent" | "excluded" | "failed" }[];
};

function whenLabel(date: string, startTime: string, isToday: boolean): string {
  if (isToday) return `היום בשעה ${startTime}`;
  return `${describeSlot({ date, startTime }).replace(/ ב‑\d\d:\d\d$/, "")} בשעה ${startTime}`;
}

export async function executeClosure(input: ClosureInput, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  // Re-plan at execution time: the gate the barber saw is the gate we enforce,
  // and a slot may have been taken in the meantime.
  const plan: ClosurePlan = await planClosure(input);
  const excluded = new Set(opts.excludeAppointmentIds ?? []);
  const notified = plan.displaced.filter(d => !excluded.has(d.appointmentId));
  const distinct = new Set(notified.flatMap(d => d.options.map(o => `${o.staffId}|${o.date}|${o.startTime}`)));
  if (notified.some(d => !d.options.length) || distinct.size < notified.length) {
    throw new Error("gate_blocked");
  }

  const business = await prisma.business.findUnique({ where: { id: input.businessId }, select: { closureNoticeTemplate: true } });
  const template = (opts.templateOverride?.trim() || business?.closureNoticeTemplate?.trim() || DEFAULT_CLOSURE_NOTICE_TEMPLATE);
  const dateObj = new Date(input.date + "T00:00:00.000Z");
  const expiresAt = new Date(Date.now() + HOLD_HOURS * 3600_000);

  // ── one transaction: closure + override + cancellations + proposals + holds ──
  const closure = await prisma.$transaction(async tx => {
    const c = await tx.calendarClosure.create({
      data: {
        businessId: input.businessId, staffId: input.staffId, date: dateObj,
        fromTime: input.fromTime ?? null, toTime: input.toTime ?? null,
        reason: opts.reason ?? null, createdByStaffId: opts.createdByStaffId ?? null,
      },
    });
    // Schedule override: whole day → not working; partial → keep the remaining hours.
    const existing = await tx.staffScheduleOverride.findFirst({ where: { staffId: input.staffId, date: dateObj } });
    let overrideData: { isWorking: boolean; slots?: string | null };
    if (!input.fromTime || !input.toTime) overrideData = { isWorking: false, slots: null };
    else {
      const sched = await tx.staffSchedule.findFirst({ where: { staffId: input.staffId, dayOfWeek: dateObj.getUTCDay() } });
      const base: { start: string; end: string }[] = existing?.slots ? JSON.parse(existing.slots) : sched?.slots ? JSON.parse(sched.slots) : [];
      const f = timeToMinutes(input.fromTime), t = timeToMinutes(input.toTime);
      const kept: { start: string; end: string }[] = [];
      for (const s of base) {
        const a = timeToMinutes(s.start), b = timeToMinutes(s.end);
        if (a < f) kept.push({ start: s.start, end: minutesToTime(Math.min(b, f)) });
        if (b > t) kept.push({ start: minutesToTime(Math.max(a, t)), end: s.end });
      }
      overrideData = kept.length ? { isWorking: true, slots: JSON.stringify(kept) } : { isWorking: false, slots: null };
    }
    if (existing) await tx.staffScheduleOverride.update({ where: { id: existing.id }, data: { ...overrideData, reason: opts.reason ?? existing.reason } });
    else await tx.staffScheduleOverride.create({ data: { staffId: input.staffId, date: dateObj, ...overrideData, reason: opts.reason ?? null } });

    for (const d of plan.displaced) {
      await tx.appointment.update({
        where: { id: d.appointmentId },
        data: { status: "cancelled_by_staff", cancelledAt: new Date(), closureId: c.id },
      });
      if (excluded.has(d.appointmentId)) continue;
      const proposal = await tx.swapProposal.create({
        data: {
          businessId: input.businessId, primaryAppointmentId: d.appointmentId,
          kind: "move", initiatedBy: "admin", closureId: c.id,
          targetStaffId: d.options[0].staffId, targetDate: new Date(d.options[0].date + "T00:00:00.000Z"), targetStartTime: d.options[0].startTime,
          optionsJson: JSON.stringify(d.options.map(o => ({ staffId: o.staffId, staffName: o.staffName, date: o.date, startTime: o.startTime, sameStaff: o.sameStaff }))),
          status: "pending_response", expiresAt,
        },
      });
      for (const o of d.options) {
        await tx.slotHold.create({
          data: {
            businessId: input.businessId, staffId: o.staffId, date: new Date(o.date + "T00:00:00.000Z"),
            startTime: o.startTime, endTime: minutesToTime(timeToMinutes(o.startTime) + d.service.durationMinutes),
            customerId: d.customer.id, proposalId: proposal.id, expiresAt,
          },
        });
      }
    }
    return c;
  });

  // ── send, nearest appointment first, immediately (service message) ──
  const result: ExecuteResult = { closureId: closure.id, sent: 0, excluded: excluded.size, failed: 0, perCustomer: [] };
  const order = [...notified].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  for (const d of order) {
    const text = opts.customTextByAppointmentId?.[d.appointmentId]?.trim()
      || renderClosureText(template, {
        name: d.customer.name, barber: plan.staffName,
        when: whenLabel(input.date, d.startTime, plan.isToday),
        options: d.options as (SlotOption & { staffName: string })[],
      });
    try {
      await sendProactiveMessage({
        businessId: input.businessId, customerPhone: d.customer.phone, customerName: d.customer.name,
        appointmentId: d.appointmentId, kind: "closure_notice", body: text,
        sentByStaffId: opts.createdByStaffId ?? input.staffId,
        escalate: false, // the agent must keep answering this thread
      });
      result.sent++; result.perCustomer.push({ appointmentId: d.appointmentId, customerName: d.customer.name, state: "sent" });
    } catch (e) {
      console.error("[closure] notice send failed", d.appointmentId, e);
      result.failed++; result.perCustomer.push({ appointmentId: d.appointmentId, customerName: d.customer.name, state: "failed" });
    }
  }
  for (const d of plan.displaced) if (excluded.has(d.appointmentId)) result.perCustomer.push({ appointmentId: d.appointmentId, customerName: d.customer.name, state: "excluded" });
  return result;
}
