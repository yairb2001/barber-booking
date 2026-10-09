/**
 * Sales calls: booking (by the sales agent or a rep), cancelling, and the
 * rep's one-tap outcome after the call — each outcome moves the lead's stage
 * and fires its automation.
 */
import { prisma } from "@/lib/prisma";
import { enqueueMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { notifyPlatformOwner } from "@/lib/super-admin";
import { pushToOwner } from "@/lib/native/push";
import { SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { createBusinessFromLead } from "@/lib/leads";
import { freeCallSlots, getCrmSettings, legacyStatusFor, slotLabel, type Stage } from "@/lib/crm/core";
import { startAutomation, stopLeadAutomations } from "@/lib/crm/automations";

export async function setLeadStage(leadId: string, stage: Stage, extra: { lostReason?: string | null } = {}): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: { stage, status: legacyStatusFor(stage), ...(extra.lostReason !== undefined ? { lostReason: extra.lostReason } : {}) } });
}

/** Tell the call's rep (Yair: from DOMINANT's line + app push; another rep: from Chator's number). */
export async function alertRep(repId: string | null, body: string): Promise<void> {
  const rep = repId ? await prisma.salesRep.findUnique({ where: { id: repId } }) : null;
  if (!rep || rep.isOwner) {
    notifyPlatformOwner(body).catch(() => {});
    pushToOwner(SUPER_ADMIN_BUSINESS_ID, { title: "Chator CRM", body: body.split("\n")[0], data: { type: "crm" } }).catch(() => {});
    return;
  }
  if (rep.phone) await enqueueMessage({ businessId: DEMO_BUSINESS_ID, customerPhone: normalizeIsraeliPhone(rep.phone), kind: "crm_rep_alert", body, scheduledFor: new Date() }).catch(() => {});
}

export type BookResult = { ok: true; callId: string; startsAt: Date; repName: string; label: string } | { ok: false; error: string };

/** Book a call at an exact time. Without repId the soonest free rep at that minute is taken. */
export async function bookCall(p: { leadId: string; startsAt: Date; repId?: string | null; bookedBy: "agent" | "rep" }): Promise<BookResult> {
  const lead = await prisma.lead.findUnique({ where: { id: p.leadId } });
  if (!lead) return { ok: false, error: "lead not found" };
  const s = await getCrmSettings();
  const slots = await freeCallSlots({ repId: p.repId ?? undefined, limit: 500, days: s.horizonDays + 1 });
  const slot = slots.find(x => Math.abs(x.startsAt.getTime() - p.startsAt.getTime()) < 60_000);
  if (!slot) return { ok: false, error: "השעה הזאת כבר לא פנויה" };
  // One booked call per lead: a new booking replaces the old one.
  const old = await prisma.salesCall.findMany({ where: { leadId: lead.id, status: "booked" }, select: { id: true } });
  if (old.length) await prisma.salesCall.updateMany({ where: { id: { in: old.map(o => o.id) } }, data: { status: "cancelled", notes: "הוחלפה בשיחה חדשה" } });
  const call = await prisma.salesCall.create({ data: { leadId: lead.id, repId: slot.repId, startsAt: slot.startsAt, durationMin: s.callMinutes, bookedBy: p.bookedBy } });
  await prisma.lead.update({ where: { id: lead.id }, data: { repId: slot.repId } });
  await setLeadStage(lead.id, "call_booked");
  await stopLeadAutomations(lead.id, "call_booked");
  await startAutomation("call_booked", { leadId: lead.id, context: { callId: call.id } });
  const label = slotLabel(slot.startsAt);
  await alertRep(slot.repId, `📞 נקבעה שיחה ${label}\n${lead.name || "ליד"}${lead.businessName ? ` · ${lead.businessName}` : ""} · ${lead.phone}${lead.summary ? `\n${lead.summary}` : ""}`);
  return { ok: true, callId: call.id, startsAt: slot.startsAt, repName: slot.repName, label };
}

export async function cancelCall(callId: string, by: "lead" | "rep"): Promise<boolean> {
  const call = await prisma.salesCall.findUnique({ where: { id: callId } });
  if (!call || call.status !== "booked") return false;
  await prisma.salesCall.update({ where: { id: callId }, data: { status: "cancelled", notes: by === "lead" ? "בוטלה על ידי הליד" : "בוטלה על ידי הנציג" } });
  await setLeadStage(call.leadId, "chatting");
  if (by === "lead") {
    const lead = await prisma.lead.findUnique({ where: { id: call.leadId }, select: { name: true, phone: true } });
    await alertRep(call.repId, `השיחה ${slotLabel(call.startsAt)} עם ${lead?.name || lead?.phone} בוטלה על ידי הליד.`);
  }
  return true;
}

export type Outcome = "won" | "later" | "no_answer" | "not_relevant";

/** The rep's one tap after a call. */
export async function setCallOutcome(p: { leadId: string; outcome: Outcome; callId?: string | null; followUpAt?: Date | null; lostReason?: string | null }): Promise<{ ok: boolean; link?: string; error?: string }> {
  const call = p.callId ? await prisma.salesCall.findUnique({ where: { id: p.callId } })
    : await prisma.salesCall.findFirst({ where: { leadId: p.leadId, status: "booked" }, orderBy: { startsAt: "desc" } });
  if (call) await prisma.salesCall.update({ where: { id: call.id }, data: { status: "done", outcome: p.outcome } });
  await stopLeadAutomations(p.leadId, `outcome_${p.outcome}`);
  if (p.outcome === "won") {
    const r = await createBusinessFromLead(p.leadId); // creates the tenant + sends the personal setup link
    await setLeadStage(p.leadId, "trial");
    await startAutomation("call_won", { leadId: p.leadId, businessId: r.businessId });
    return { ok: true, link: r.link };
  }
  if (p.outcome === "later") {
    await prisma.lead.update({ where: { id: p.leadId }, data: { followUpAt: p.followUpAt ?? new Date(Date.now() + 7 * 86400_000) } });
    await setLeadStage(p.leadId, "chatting");
    return { ok: true };
  }
  if (p.outcome === "no_answer") {
    await setLeadStage(p.leadId, "chatting");
    await startAutomation("call_no_answer", { leadId: p.leadId });
    return { ok: true };
  }
  await setLeadStage(p.leadId, "not_relevant", { lostReason: p.lostReason ?? null });
  return { ok: true };
}
