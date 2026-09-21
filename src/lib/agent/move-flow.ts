// Moving an appointment in code (owner's decision 21.9.2026: "פחות פינג פונג").
// The real move conversations (2–21.9): "יש אפשרות להקדים?" ×4, "להקדים למחר?",
// "אפשרי לאחר את התור?" → "12" → taken → swap. Nine model calls for one request.
// Here: intent + ONE upcoming appointment → the code asks for / reads the target,
// checks the barber's day, confirms, executes — or offers the swap. Free text at
// any stage goes to the model with the state as context.
import { prisma } from "@/lib/prisma";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { getBusinessNow, addDaysISO, getDayOfWeekISO, timeToMinutes } from "@/lib/utils";
import { computeDayAvailability } from "@/lib/agent/availability";
import { classifyReply, dayLabelHe, firstNameOf, type ExecTool, type ProposalOutcome } from "@/lib/agent/booking-proposals";

const MOVE_INTENT = /להזיז|תזיז|להעביר|תעביר|לדחות|תדחה|להקדים|תקדים|לאחר את התור|לשנות את התור|להחליף את התור|אפשר להחליף.*תור|reschedule|move my/i;
const NOT_MOVE = /לבטל|ביטול|תבטל|תור נוסף|עוד תור|מאחר|מתעכב|איחור|אאחר|late/i;
const EARLIER = /להקדים|תקדים|מוקדם יותר|יותר מוקדם|קודם/;
const LATER = /לאחר|לדחות|תדחה|מאוחר יותר|יותר מאוחר|אחר כך/;
const KEEP = /להשאיר|תשאיר|נשאר|לא להזיז|לא צריך|עזוב|סבבה ככה|בסדר ככה|נשאיר/;
const SWAP_YES = /החלפה|להחליף|תחליף|תנסה|נסה|תבדוק|לבדוק|^1\b|כן/;
const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const MOVE_TTL_MS = 2 * 60 * 60 * 1000;

type MoveMeta = {
  appointmentId: string; staffId: string; staffName: string; serviceId: string; serviceName: string;
  dateISO: string; startTime: string;                      // the existing appointment
  stage: "target" | "pick" | "confirm" | "swapOrPick" | "keepOrOther";
  targetDate?: string; targetTime?: string; options?: string[]; direction?: "earlier" | "later" | null;
};
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const dayName = (iso: string, today: string) => { const off = Math.round((Date.parse(iso) - Date.parse(today)) / 864e5); return off === 0 ? "היום" : off === 1 ? "מחר" : DAY[getDayOfWeekISO(iso)]; };

/** Day in the customer's text: מחר / היום / יום X / 22.9. Null = not said. */
export function parseTargetDay(text: string, today: string): string | null {
  if (/מחרתיים/.test(text)) return addDaysISO(today, 2);
  if (/(^|[\s,])ל?מחר(?=$|[\s?,.!])/.test(text)) return addDaysISO(today, 1);
  if (/(^|[\s,])ל?היום(?=$|[\s?,.!])/.test(text)) return today;
  const num = text.match(/(?:^|[\s,\-])(\d{1,2})[./](\d{1,2})(?=$|[\s?,.!])/);
  if (num) { for (let d = 0; d < 21; d++) { const iso = addDaysISO(today, d); const dd = new Date(iso + "T00:00:00.000Z"); if (dd.getUTCDate() === Number(num[1]) && dd.getUTCMonth() + 1 === Number(num[2])) return iso; } return null; }
  const dm = Array.from(text.matchAll(/(?:^|[\s,])(?:ב|ביום |יום |ל|ליום )?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?=$|[\s?,.!])/g));
  if (dm.length) { const dow = DAY.indexOf(dm[dm.length - 1][1]); for (let d = 0; d < 8; d++) { const iso = addDaysISO(today, d); if (getDayOfWeekISO(iso) === dow) return iso; } }
  return null;
}

/** Time in the customer's text ("12", "12:00", "1430", "ב-6:30"). Ambiguous hours
 *  ("6") are resolved toward the barber's working span that day; `exclude` = the
 *  appointment's own time ("יש לי תור ב-17:30, אפשר להקדים?"). */
export function parseTargetTime(text: string, span: { first: number; last: number } | null, exclude?: string | null): string | null {
  const t = text.replace(/[‎‏‪-‮⁦-⁩﻿]/g, "");
  // "2.10" is a date (day.month), "6.30" is a time — a dotted pair whose second
  // part is a plausible month and not a quarter-hour is dropped before time parsing.
  const t2 = t.replace(/(^|[\s,\-])\d{1,2}[./](0?[1-9]|1[0-2])(?=$|[\s?,.!])/g, (m0: string, pre: string, mo: string) => /^(00|15|30|45)$/.test(mo) ? m0 : pre);
  const cands: number[] = [];
  const m1 = t2.match(/(?:^|[^\d])(\d{1,2})[:.](\d{2})(?!\d)/); if (m1) cands.push(Number(m1[1]) * 60 + Number(m1[2]));
  const m2 = !m1 && t2.match(/(?:^|[^\d:])(\d{2})(\d{2})(?!\d)/); if (m2 && Number(m2[1]) <= 23 && Number(m2[2]) <= 59) cands.push(Number(m2[1]) * 60 + Number(m2[2]));
  const m3 = !m1 && !m2 && t2.match(/(?:^|[^\d.:/])ב?-?(\d{1,2})(?!\d|[./:]\d)/); if (m3) cands.push(Number(m3[1]) * 60);
  if (!cands.length) return null;
  let m = cands[0];
  if (m % 60 === 0 || cands.length) {
    const h = Math.floor(m / 60);
    if (h <= 8 && span) { const alt = m + 12 * 60; const inSpan = (x: number) => x >= span.first - 60 && x <= span.last + 60; if (!inSpan(m) && inSpan(alt)) m = alt; }
    else if (h <= 7 && !span) m += 12 * 60;
  }
  if (m < 6 * 60 || m > 23 * 60) return null;
  const hhmm = fmt(m);
  return exclude && hhmm === exclude ? null : hhmm;
}

async function upcomingOne(businessId: string, customerId: string) {
  const nowBiz = getBusinessNow();
  const todayStart = new Date(nowBiz.date + "T00:00:00.000Z");
  const list = (await prisma.appointment.findMany({
    where: { businessId, customerId, date: { gte: todayStart }, status: { in: ["pending", "confirmed"] } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }], take: 3,
    select: { id: true, date: true, startTime: true, staffId: true, serviceId: true, staff: { select: { name: true } }, service: { select: { name: true } } },
  })).filter(a => a.date.toISOString().slice(0, 10) !== nowBiz.date || timeToMinutes(a.startTime) >= nowBiz.minutes);
  return list.length === 1 ? list[0] : null;
}

async function freeSlots(businessId: string, staffId: string, serviceId: string, dateISO: string, customerId?: string): Promise<string[]> {
  const avail = await computeDayAvailability(businessId, dateISO, staffId, serviceId, customerId ? { exemptHoldsCustomerId: customerId } : undefined);
  return avail.find(a => a.staffId === staffId)?.slots ?? [];
}

async function save(businessId: string, phone: string, conversationId: string, meta: MoveMeta, existingId?: string) {
  const ph = normalizeIsraeliPhone(phone);
  if (existingId) { await prisma.bookingProposal.update({ where: { id: existingId }, data: { note: JSON.stringify(meta), date: meta.targetDate ? new Date(meta.targetDate + "T00:00:00.000Z") : new Date(meta.dateISO + "T00:00:00.000Z"), startTime: meta.targetTime ?? meta.startTime } }); return; }
  await prisma.bookingProposal.updateMany({ where: { businessId, phone: ph, status: "pending" }, data: { status: "superseded", respondedAt: new Date() } });
  await prisma.bookingProposal.create({ data: { businessId, phone: ph, conversationId, kind: "move", staffId: meta.staffId, serviceId: meta.serviceId, date: new Date(meta.dateISO + "T00:00:00.000Z"), startTime: meta.startTime, note: JSON.stringify(meta), expiresAt: new Date(Date.now() + MOVE_TTL_MS) } });
}
const close = (id: string, status: "accepted" | "rejected") => prisma.bookingProposal.update({ where: { id }, data: { status, respondedAt: new Date() } });

/** "אפשר להקדים?" / "להזיז את התור ל-12" with exactly one upcoming appointment. */
export async function maybeStartMoveFlow(p: { businessId: string; phone: string; conversationId: string; text: string; customer: { id: string; name: string } | null }): Promise<ProposalOutcome> {
  const text = p.text.trim();
  if (!MOVE_INTENT.test(text) || NOT_MOVE.test(text) || text.split(/\s+/).length > 16 || !p.customer) return {};
  const a = await upcomingOne(p.businessId, p.customer.id);
  if (!a) return {};
  const meta: MoveMeta = { appointmentId: a.id, staffId: a.staffId, staffName: a.staff.name, serviceId: a.serviceId, serviceName: a.service.name, dateISO: a.date.toISOString().slice(0, 10), startTime: a.startTime, stage: "target", direction: EARLIER.test(text) ? "earlier" : LATER.test(text) ? "later" : null };
  return advance(p, meta, text, null);
}

/** A reply while a move is in progress. */
export async function handleMoveReply(p: { businessId: string; phone: string; conversationId: string; text: string; customer: { id: string; name: string } | null; execTool: ExecTool; sandbox: boolean }, pending: { id: string; note: string | null }): Promise<ProposalOutcome> {
  const meta = (() => { try { return JSON.parse(pending.note ?? "{}") as MoveMeta; } catch { return null; } })();
  if (!meta?.appointmentId) return {};
  const text = p.text.trim();
  const today = getBusinessNow().date;
  const what = `התור ${dayLabelHe(meta.dateISO)} בשעה ${meta.startTime} אצל ${meta.staffName}`;
  const ctx = (extra: string) => ({ context: `הלקוח מזיז את ${what} (מזהה ${meta.appointmentId}). ${extra} תשובתו עכשיו: "${text.slice(0, 120)}". שעה/יום ברורים → request_appointment_move; רוצה להשאיר → אמור שהתור נשאר; אחרת עזור בקצרה.` });

  if (KEEP.test(text) || (meta.stage !== "confirm" && classifyReply(text) === "no")) { await close(pending.id, "rejected"); return { reply: `סבבה, ${what} נשאר כמו שהוא 👍` }; }

  if (meta.stage === "confirm" && meta.targetDate && meta.targetTime) {
    const cls = classifyReply(text, meta.targetTime);
    if (cls === "yes") {
      const result = await p.execTool("request_appointment_move", { appointmentId: meta.appointmentId, targetDate: meta.targetDate, targetStartTime: meta.targetTime });
      const ok = p.sandbox || result.startsWith("✅");
      await close(pending.id, ok ? "accepted" : "rejected");
      if (ok) return { reply: `סגור, התור עבר ל${dayLabelHe(meta.targetDate)} בשעה ${meta.targetTime} אצל ${meta.staffName}. נתראה 💈` };
      return { context: `הלקוח אישר להעביר את ${what} ל-${meta.targetDate} ${meta.targetTime} אבל ההעברה נכשלה: "${result.slice(0, 200)}". הסבר בכנות והצע חלופה.` };
    }
    if (cls === "no") { await close(pending.id, "rejected"); return { reply: `סבבה, ${what} נשאר כמו שהוא 👍` }; }
    // a different time/day → evaluate it instead
    return advance(p, meta, text, pending.id);
  }

  if (meta.stage === "swapOrPick" && meta.targetDate && meta.targetTime) {
    const picked = parseTargetTime(text, null, meta.startTime);
    if (picked && (meta.options ?? []).includes(picked)) return advance(p, { ...meta, stage: "pick" }, text, pending.id);
    if (SWAP_YES.test(text) && !picked) {
      const result = await p.execTool("request_appointment_move", { appointmentId: meta.appointmentId, targetDate: meta.targetDate, targetStartTime: meta.targetTime, insistExactTime: "true" });
      const ok = p.sandbox || /שלחתי|בקשה/.test(result);
      await close(pending.id, ok ? "accepted" : "rejected");
      if (ok) return { reply: `בודק מול ${meta.staffName} אפשרות להחלפה ל-${meta.targetTime}, אעדכן אותך ברגע שיש תשובה 👍` };
      return { context: `הלקוח ביקש לנסות החלפה ל-${meta.targetDate} ${meta.targetTime} אבל זה לא הצליח: "${result.slice(0, 200)}". הסבר והצע חלופה.` };
    }
    return advance(p, meta, text, pending.id);
  }

  return advance(p, meta, text, pending.id);
}

/** Read a target (day/time/direction) from `text` and move the flow forward. */
async function advance(p: { businessId: string; phone: string; conversationId: string; customer: { id: string; name: string } | null }, meta: MoveMeta, text: string, existingId: string | null): Promise<ProposalOutcome> {
  const today = getBusinessNow().date;
  const first = firstNameOf(p.customer?.name);
  const hi = first ? first + ", " : "";
  const what = `התור ${dayLabelHe(meta.dateISO)} בשעה ${meta.startTime} אצל ${meta.staffName}`;
  const ctx = (extra: string) => ({ context: `הלקוח מזיז את ${what} (מזהה ${meta.appointmentId}). ${extra} כתב: "${text.slice(0, 120)}". שעה/יום ברורים → request_appointment_move (insistExactTime רק אם מתעקש על שעה תפוסה); רוצה להשאיר → אמור שהתור נשאר; אחרת עזור בקצרה.` });
  const direction = EARLIER.test(text) ? "earlier" : LATER.test(text) ? "later" : meta.direction ?? null;
  const day = parseTargetDay(text, today) ?? meta.targetDate ?? meta.dateISO;
  if (day < today) return ctx("היום שביקש כבר עבר.");
  const daySlots = await freeSlots(p.businessId, meta.staffId, meta.serviceId, day, p.customer?.id);
  const span = daySlots.length ? { first: timeToMinutes(daySlots[0]), last: timeToMinutes(daySlots[daySlots.length - 1]) } : null;
  const time = parseTargetTime(text, span, day === meta.dateISO ? meta.startTime : null);
  const sameDay = day === meta.dateISO;
  const label = `${dayName(day, today)} ${Number(day.slice(8, 10))}.${Number(day.slice(5, 7))}`;

  if (time) {
    if (daySlots.includes(time)) {
      const next: MoveMeta = { ...meta, stage: "confirm", targetDate: day, targetTime: time, direction };
      await save(p.businessId, p.phone, p.conversationId, next, existingId ?? undefined);
      return { reply: `${hi}להעביר את התור ל${sameDay ? "שעה" : label + " בשעה"} ${time} אצל ${meta.staffName}?\nמאשר?` };
    }
    // taken → nearest free the same day, plus the swap option when someone holds that slot
    const near = daySlots.map(s => ({ s, d: Math.abs(timeToMinutes(s) - timeToMinutes(time)) })).sort((a, b) => a.d - b.d).slice(0, 3).map(x => x.s).sort();
    const occupied = await prisma.appointment.findFirst({ where: { businessId: p.businessId, staffId: meta.staffId, date: new Date(day + "T00:00:00.000Z"), startTime: time, status: { in: ["pending", "confirmed"] }, NOT: { customerId: p.customer?.id ?? "" } }, select: { id: true } });
    const cfg = await prisma.agentConfig.findUnique({ where: { businessId: p.businessId }, select: { allowSwapOffers: true } });
    const swapOk = !!occupied && cfg?.allowSwapOffers !== false;
    if (!near.length && !swapOk) { await save(p.businessId, p.phone, p.conversationId, { ...meta, stage: "keepOrOther", direction }, existingId ?? undefined); return { reply: `${time} תפוס אצל ${meta.staffName}, ואין לו שעה אחרת פנויה ${label}. להשאיר את התור ב-${meta.startTime}, או לבדוק יום אחר?` }; }
    const next: MoveMeta = { ...meta, stage: "swapOrPick", targetDate: day, targetTime: time, options: near, direction };
    await save(p.businessId, p.phone, p.conversationId, next, existingId ?? undefined);
    const alt = near.length ? `פנוי אצלו ${sameDay ? "באותו יום" : label}: ${near.join(" · ")}.` : `אין לו שעה אחרת פנויה ${label}.`;
    const swap = swapOk ? ` אפשר גם לנסות החלפה עם הלקוח שב-${time} (${meta.staffName} צריך לאשר).` : "";
    return { reply: `${time} תפוס אצל ${meta.staffName}. ${alt}${swap} מה מעדיף?` };
  }

  // no time — a direction ("להקדים") or a day → list what fits
  const cur = timeToMinutes(meta.startTime);
  const fit = daySlots.filter(s => !sameDay || (direction === "earlier" ? timeToMinutes(s) < cur : direction === "later" ? timeToMinutes(s) > cur : true));
  if (direction || parseTargetDay(text, today) || meta.stage !== "target") {
    if (fit.length) {
      const shown = direction === "later" ? fit.slice(0, 4) : fit.slice(-4);
      const next: MoveMeta = { ...meta, stage: "pick", targetDate: day, options: shown, direction };
      await save(p.businessId, p.phone, p.conversationId, next, existingId ?? undefined);
      const verb = direction === "earlier" ? "להקדים" : direction === "later" ? "לדחות" : "להעביר";
      return { reply: `${hi}אפשר ${verb} אצל ${meta.staffName} ${sameDay ? "באותו יום" : label}: ${shown.join(" · ")}. איזו שעה?` };
    }
    const next: MoveMeta = { ...meta, stage: "keepOrOther", targetDate: day, direction };
    await save(p.businessId, p.phone, p.conversationId, next, existingId ?? undefined);
    const none = direction === "earlier" ? `אין אצל ${meta.staffName} שעה מוקדמת יותר ${sameDay ? "באותו יום" : label}` : direction === "later" ? `אין אצל ${meta.staffName} שעה מאוחרת יותר ${sameDay ? "באותו יום" : label}` : `אין אצל ${meta.staffName} מקום ${label}`;
    return { reply: `${hi}${none}. להשאיר את התור ${dayLabelHe(meta.dateISO)} ב-${meta.startTime}, או לבדוק יום אחר / ספר אחר?` };
  }
  // plain "להזיז את התור" — ask for the target
  await save(p.businessId, p.phone, p.conversationId, { ...meta, stage: "target" }, existingId ?? undefined);
  return { reply: `${hi}להזיז את ${what} — לאיזו שעה? (אפשר גם יום אחר)` };
}
