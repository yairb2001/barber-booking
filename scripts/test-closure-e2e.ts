/**
 * Calendar-closure end-to-end test on a THROWAWAY business (no WhatsApp provider
 * → sendMessage logs "provider_not_configured", nothing leaves). Creates 2 barbers,
 * 1 service, 4 customers, 4 appointments on a future day, runs: plan → gate →
 * execute → replies (pick A / pick by time / decline / silent) → sweep → summary.
 * Counts every side effect, then deletes EVERYTHING it created and verifies 0.
 * Run: npx tsx --env-file=.env scripts/test-closure-e2e.ts
 */
import { prisma } from "../src/lib/prisma";
import { planClosure } from "../src/lib/closures/plan";
import { executeClosure } from "../src/lib/closures/execute";
import { handleClosureReply, resolvePick } from "../src/lib/closures/reply";
import { runClosureSweep, summarizeClosure } from "../src/lib/closures/status";
import { addDaysISO, getBusinessNow } from "../src/lib/utils";

const TAG = "E2E-CLOSURE";
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };

async function main() {
  const today = getBusinessNow().date;
  const day = addDaysISO(today, 7); // a week ahead — never "today"
  const dayObj = new Date(day + "T00:00:00.000Z");
  const dow = dayObj.getUTCDay();

  // ── sandbox business ──
  const biz = await prisma.business.create({ data: { name: `${TAG} מספרה`, slug: `e2e-closure-${Date.now()}`, tier: "premium" } });
  const svc = await prisma.service.create({ data: { businessId: biz.id, name: "תספורת", price: 80, durationMinutes: 30 } });
  const [yair, nitai] = await Promise.all([
    prisma.staff.create({ data: { businessId: biz.id, name: "יאיר בדיקה", phone: "0500000001", role: "owner" } }),
    prisma.staff.create({ data: { businessId: biz.id, name: "ניתאי בדיקה", phone: "0500000002", role: "barber" } }),
  ]);
  for (const st of [yair, nitai]) {
    await prisma.staffService.create({ data: { staffId: st.id, serviceId: svc.id } });
    for (let d = 0; d < 7; d++) await prisma.staffSchedule.create({ data: { staffId: st.id, dayOfWeek: d, isWorking: d !== 6, slots: JSON.stringify([{ start: "10:00", end: "18:00" }]) } });
  }
  const mkCust = (n: string, p: string) => prisma.customer.create({ data: { businessId: biz.id, name: n, phone: p } });
  const [c1, c2, c3, c4, c5] = await Promise.all([mkCust("לוי לויאלי", "0521000001"), mkCust("חדש חדשי", "0521000002"), mkCust("מסרב סרבן", "0521000003"), mkCust("שקט שותק", "0521000004"), mkCust("סוכן סוכני", "0521000005")]);
  // loyalty history: c1 = 3 past visits with yair (100%); c2 new; c3 = 1 with nitai, 1 with yair (50%); c4 = 2 with yair
  const past = (cid: string, sid: string, daysAgo: number) => prisma.appointment.create({ data: {
    businessId: biz.id, customerId: cid, staffId: sid, serviceId: svc.id, date: new Date(addDaysISO(today, -daysAgo) + "T00:00:00.000Z"),
    startTime: "11:00", endTime: "11:30", status: "completed", price: 80 } });
  await Promise.all([past(c1.id, yair.id, 30), past(c1.id, yair.id, 60), past(c1.id, yair.id, 90), past(c3.id, nitai.id, 20), past(c3.id, yair.id, 40), past(c4.id, yair.id, 25), past(c4.id, yair.id, 50), past(c5.id, nitai.id, 15), past(c5.id, yair.id, 45)]);
  // the day being closed: 5 appointments with yair 13:00–15:30
  const mk = (cid: string, t: string, e: string) => prisma.appointment.create({ data: { businessId: biz.id, customerId: cid, staffId: yair.id, serviceId: svc.id, date: dayObj, startTime: t, endTime: e, status: "confirmed", price: 80 } });
  const [a1, a2, a3, a4, a5] = await Promise.all([mk(c1.id, "13:00", "13:30"), mk(c2.id, "13:30", "14:00"), mk(c3.id, "14:00", "14:30"), mk(c4.id, "14:30", "15:00"), mk(c5.id, "15:00", "15:30")]);

  console.log(`\n▶ sandbox ${biz.id} · closing ${day} 13:00–15:30 (dow ${dow})`);

  // ── 1) plan ──
  const plan = await planClosure({ businessId: biz.id, staffId: yair.id, date: day, fromTime: "13:00", toTime: "15:30" });
  console.log("1) PLAN");
  ok(plan.displaced.length === 5, `5 displaced (got ${plan.displaced.length})`);
  const byId = Object.fromEntries(plan.displaced.map(d => [d.appointmentId, d]));
  ok(byId[a1.id].loyalty.share === 1 && !byId[a1.id].loyalty.anyStaffAllowed, "c1 100% loyal → same barber only");
  ok(byId[a2.id].loyalty.share === null && byId[a2.id].loyalty.anyStaffAllowed, "c2 new → any barber");
  ok(byId[a3.id].loyalty.share === 0.5 && byId[a3.id].loyalty.anyStaffAllowed, "c3 50% → any barber");
  ok(byId[a1.id].options.every(o => o.sameStaff), "c1 options are all at yair");
  ok(plan.displaced.every(d => d.options.length === 2), "every customer got 2 options");
  ok(plan.displaced.every(d => d.options.every(o => !(o.date === day && o.sameStaff && o.startTime >= "13:00" && o.startTime < "15:30"))), "no option inside the closed window");
  const keys = plan.displaced.map(d => `${d.options[0].staffId}|${d.options[0].date}|${d.options[0].startTime}`);
  ok(new Set(keys).size === keys.length, "primary options are distinct across customers");
  ok(plan.gate.ok, `gate OK (needed ${plan.gate.needed}, distinct ${plan.gate.distinctSlots})`);

  // ── 2) execute (c4 excluded → manual) ──
  console.log("2) EXECUTE");
  const res = await executeClosure({ businessId: biz.id, staffId: yair.id, date: day, fromTime: "13:00", toTime: "15:30" }, { reason: "בדיקה", excludeAppointmentIds: [a4.id], createdByStaffId: yair.id });
  ok(res.sent === 4 && res.excluded === 1 && res.failed === 0, `sent=4 excluded=1 failed=0 (got ${res.sent}/${res.excluded}/${res.failed})`);
  const appts = await prisma.appointment.findMany({ where: { id: { in: [a1.id, a2.id, a3.id, a4.id] } } });
  ok(appts.every(a => a.status === "cancelled_by_staff" && a.closureId === res.closureId), "all 4 cancelled_by_staff + linked to closure");
  const props = await prisma.swapProposal.findMany({ where: { closureId: res.closureId } });
  ok(props.length === 4, `4 proposals (excluded gets none) (got ${props.length})`);
  const holds = await prisma.slotHold.count({ where: { proposalId: { in: props.map(p => p.id) } } });
  ok(holds === 8, `8 slot holds (2 per proposal) (got ${holds})`);
  const ov = await prisma.staffScheduleOverride.findFirst({ where: { staffId: yair.id, date: dayObj } });
  ok(!!ov && ov.isWorking && JSON.stringify(JSON.parse(ov.slots || "[]")) === JSON.stringify([{ start: "10:00", end: "13:00" }, { start: "15:30", end: "18:00" }]), `override keeps 10–13 + 15:30–18 (got ${ov?.slots})`);
  const notices = await prisma.messageLog.findMany({ where: { businessId: biz.id, kind: "closure_notice" } });
  ok(notices.length === 4, `4 closure_notice logs (got ${notices.length})`);
  ok(notices.every(n => n.body.includes("זה יאיר") && n.body.includes("ושוב סליחה על השינויים")), "notice is in the barber's voice with the closing line");
  ok(notices.every(n => (n.body.match(/ביום /g) || []).length <= 2), "notice never repeats the same day label for both options");
  // the customer the holds are FOR still sees his options as free; everyone else doesn't
  const p5 = props.find(p => p.primaryAppointmentId === a5.id)!; const o5 = JSON.parse(p5.optionsJson!);
  const { computeDayAvailability } = await import("../src/lib/agent/availability");
  const seenByOther = (await computeDayAvailability(biz.id, o5[0].date, o5[0].staffId, svc.id, { ignoreLimits: true })).find(r => r.staffId === o5[0].staffId)?.slots ?? [];
  const seenBySelf = (await computeDayAvailability(biz.id, o5[0].date, o5[0].staffId, svc.id, { ignoreLimits: true, exemptHoldsCustomerId: c5.id })).find(r => r.staffId === o5[0].staffId)?.slots ?? [];
  ok(!seenByOther.includes(o5[0].startTime) && seenBySelf.includes(o5[0].startTime), `held slot ${o5[0].date} ${o5[0].startTime}: hidden from others, visible to its own customer`);
  const waitlistPings = await prisma.messageLog.count({ where: { businessId: biz.id, kind: "waitlist_notify" } });
  ok(waitlistPings === 0, "no waitlist 'slot freed' messages");
  // holds are honored by availability: re-plan for a NEW customer should not offer the held primaries
  const plan2 = await planClosure({ businessId: biz.id, staffId: nitai.id, date: day, fromTime: "10:00", toTime: "10:30" }); // nothing displaced, just exercise
  ok(plan2.displaced.length === 0, "re-plan on another barber: nothing displaced (sanity)");

  // ── 3) replies ──
  console.log("3) REPLIES");
  const p1 = props.find(p => p.primaryAppointmentId === a1.id)!; const o1 = JSON.parse(p1.optionsJson!);
  ok(resolvePick("הראשון", o1, today) === 0 && resolvePick("השני", o1, today) === 1 && resolvePick(o1[1].startTime, o1, today) === 1, "resolvePick: הראשון / השני / exact time");
  ok(resolvePick("אצל ניתאי", o1, today) === null, "resolvePick: barber not among options → null (goes to agent)");
  ok(await handleClosureReply(biz.id, c1.phone, "הראשון", today) === true, "c1 'הראשון' consumed");
  const a1After = await prisma.appointment.findUnique({ where: { id: a1.id } });
  ok(a1After?.status === "confirmed" && a1After.startTime === o1[0].startTime && a1After.date.toISOString().slice(0, 10) === o1[0].date, `c1 rescheduled to ${o1[0].date} ${o1[0].startTime}`);
  ok((await prisma.slotHold.count({ where: { proposalId: p1.id } })) === 0, "c1 holds released");
  const p2 = props.find(p => p.primaryAppointmentId === a2.id)!; const o2 = JSON.parse(p2.optionsJson!);
  ok(resolvePick("13", [{ ...o2[0], startTime: "11:30" }, { ...o2[1], startTime: "13:00" }], today) === 1, "resolvePick: bare hour '13' → the 13:00 option (real case 18.9)");
  ok(await handleClosureReply(biz.id, c2.phone, `${Number(o2[1].startTime.split(":")[0])} מעולה`, today) === true, `c2 picked by bare hour + filler ('${Number(o2[1].startTime.split(":")[0])} מעולה') → consumed`);
  ok((await prisma.appointment.findUnique({ where: { id: a2.id } }))?.status === "confirmed", "c2 rescheduled");
  const { isDecline } = await import("../src/lib/closures/reply");
  ok(isDecline("לא") && isDecline("לא תודה!") && isDecline("לא מתאים לי"), "isDecline: bare declines");
  ok(!isDecline("לא, שעה אחרת") && !isDecline("לא מחר") && !isDecline("לאן"), "isDecline: 'לא + request' is NOT a decline (goes to agent)");
  ok(await handleClosureReply(biz.id, c3.phone, "לא, אפשר יום אחר?", today) === false, "c3 'לא + request' → not consumed (agent takes it)");
  ok(await handleClosureReply(biz.id, c3.phone, "לא תודה", today) === true, "c3 decline consumed");
  ok((await prisma.swapProposal.findUnique({ where: { id: props.find(p => p.primaryAppointmentId === a3.id)!.id } }))?.status === "rejected_by_customer", "c3 proposal rejected");
  ok(await handleClosureReply(biz.id, c5.phone, "יש לך משהו ביום חמישי?", today) === false, "c5 free text → not consumed (agent takes it)");
  ok((await prisma.swapProposal.findUnique({ where: { id: p5.id } }))?.rawResponse === "יש לך משהו ביום חמישי?", "c5 hand-off recorded on the proposal");
  ok((await summarizeClosure(res.closureId))!.customers.find(r => r.appointmentId === a5.id)?.state === "agent", "c5 shows as 'agent' on the card");
  const swNag = await runClosureSweep(new Date(Date.now() + 2 * 3600_000), { businessId: biz.id });
  ok((await prisma.messageLog.count({ where: { businessId: biz.id, kind: "closure_reminder", appointmentId: a5.id } })) === 0 && swNag.resent === 0, "sweep 2h later does NOT nag c5 (he answered)");
  // the agent books c5 a fresh appointment → proposal closes, holds released, card says rescheduled
  const nd = addDaysISO(day, 1);
  await prisma.appointment.create({ data: { businessId: biz.id, customerId: c5.id, staffId: nitai.id, serviceId: svc.id, date: new Date(nd + "T00:00:00.000Z"), startTime: "16:00", endTime: "16:30", status: "confirmed", price: 80 } });
  const s5 = (await summarizeClosure(res.closureId))!.customers.find(r => r.appointmentId === a5.id)!;
  ok(s5.state === "rescheduled" && (s5.detail ?? "").includes("16:00"), `c5 rebooked by the agent → 'rescheduled' (${s5.detail})`);
  ok((await prisma.slotHold.count({ where: { proposalId: p5.id } })) === 0 && (await prisma.swapProposal.findUnique({ where: { id: p5.id } }))?.status === "approved", "c5 holds released + proposal approved");
  ok(await handleClosureReply(biz.id, c1.phone, "משהו אחר", today) === false, "no pending proposal → not consumed (agent)");
  ok(await handleClosureReply(biz.id, c4.phone, "כן", today) === false, "excluded customer has no proposal → not consumed");

  // ── 4) sweep: nobody silent (c3 declined = agent), so summary fires once everyone is handled ──
  console.log("4) STATUS + SWEEP");
  let s = await summarizeClosure(res.closureId);
  const st = Object.fromEntries(s!.customers.map(r => [r.appointmentId, r.state]));
  ok(st[a1.id] === "rescheduled" && st[a2.id] === "rescheduled" && st[a3.id] === "agent" && st[a4.id] === "manual" && st[a5.id] === "rescheduled", `states: ${JSON.stringify(st)}`);
  // simulate the agent finishing c3 by marking handled → open=0 → summary
  const { markHandled } = await import("../src/lib/closures/status");
  await markHandled(res.closureId, a3.id);
  const sw = await runClosureSweep(new Date(), { businessId: biz.id });
  s = await summarizeClosure(res.closureId);
  ok(sw.summarized === 1 && s!.status === "resolved", "sweep sent summary + resolved closure");
  const summary = await prisma.messageLog.findFirst({ where: { businessId: biz.id, kind: "closure_summary" } });
  ok(!!summary && summary.customerPhone.endsWith("500000001") && summary.body.includes("3 נקבעו מחדש"), `summary went to the CLOSING BARBER only: "${summary?.body}"`);
  const toOwnerElse = await prisma.messageLog.count({ where: { businessId: biz.id, kind: { in: ["closure_summary", "closure_escalation"] }, customerPhone: { not: { endsWith: "500000001" } } } });
  ok(toOwnerElse === 0, "nothing sent to anyone but the closing barber");

  // ── cleanup ──
  console.log("CLEANUP");
  await prisma.slotHold.deleteMany({ where: { businessId: biz.id } });
  await prisma.swapProposal.deleteMany({ where: { businessId: biz.id } });
  await prisma.messageLog.deleteMany({ where: { businessId: biz.id } });
  await prisma.conversationMessage.deleteMany({ where: { conversation: { businessId: biz.id } } });
  await prisma.conversation.deleteMany({ where: { businessId: biz.id } });
  await prisma.calendarClosure.deleteMany({ where: { businessId: biz.id } });
  await prisma.appointment.deleteMany({ where: { businessId: biz.id } });
  await prisma.staffScheduleOverride.deleteMany({ where: { staffId: { in: [yair.id, nitai.id] } } });
  await prisma.staffSchedule.deleteMany({ where: { staffId: { in: [yair.id, nitai.id] } } });
  await prisma.staffService.deleteMany({ where: { staffId: { in: [yair.id, nitai.id] } } });
  await prisma.customer.deleteMany({ where: { businessId: biz.id } });
  await prisma.staff.deleteMany({ where: { businessId: biz.id } });
  await prisma.service.deleteMany({ where: { businessId: biz.id } });
  await prisma.business.delete({ where: { id: biz.id } });
  const left = await Promise.all([prisma.business.count({ where: { id: biz.id } }), prisma.calendarClosure.count({ where: { businessId: biz.id } }), prisma.slotHold.count({ where: { businessId: biz.id } }), prisma.messageLog.count({ where: { businessId: biz.id } })]);
  ok(left.every(n => n === 0), `residue = ${left.join(",")}`);
  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} · ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
