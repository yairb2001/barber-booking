/**
 * The CRM's notifications (10.10.2026: "התראות בנפרד, משימות בנפרד" and
 * "התראות רק על ה-CRM … מינימום, הודעות קטנות").
 *
 * Every platform alert is written to the CRM feed (crm_notifications). Only
 * the ones that need Yair soon also PUSH — to the CRM's own home-screen app,
 * nowhere else: a new lead, a lead asking for a person, a call the agent
 * booked or the lead cancelled, 10 minutes before a call, a customer's
 * WhatsApp down or stuck linking, a new signup, a customer whose agent package
 * ran out, a Chator customer writing to Chator's number, a platform outage.
 * Everything else (reminders that are already tasks, "WhatsApp is back",
 * 80% package…) stays in the feed only.
 *
 * Push goes to the subscriptions saved from the CRM (Business.settings
 * .crmWebPushSubs of the platform business), signed with the same VAPID pair
 * as the rest of the app.
 */
import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { VAPID_PUBLIC_KEY, type WebPushSub } from "@/lib/native/web-push";

export type NotifyKind = "lead" | "call" | "customer" | "whatsapp" | "system";
export type NotifyMeta = { kind?: NotifyKind; href?: string | null; leadId?: string | null; businessId?: string | null; repId?: string | null; push?: boolean };

const PLATFORM_BUSINESS_ID = process.env.SUPER_ADMIN_BUSINESS_ID || "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2";

const parse = (raw: string | null | undefined): Record<string, unknown> => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };
const subsOf = (s: Record<string, unknown>): WebPushSub[] => (Array.isArray(s.crmWebPushSubs) ? (s.crmWebPushSubs as WebPushSub[]) : []);

/** First line = title; the rest (minus "CRM: /admin/crm" pointers) = body. Never throws. */
export async function recordCrmNotification(text: string, meta: NotifyMeta = {}): Promise<void> {
  try {
    const lines = text.split("\n").map(l => l.trim()).filter(l => l && !/^(ב-)?CRM:/.test(l));
    const title = (lines[0] ?? "").slice(0, 200);
    if (!title) return;
    const body = lines.slice(1).join(" · ").slice(0, 600) || null;
    const href = meta.href ?? (meta.leadId ? `/admin/crm/leads/${meta.leadId}` : meta.businessId ? `/admin/crm/customers/${meta.businessId}` : null);
    const n = await prisma.crmNotification.create({ data: { kind: meta.kind ?? "system", title, body, href, leadId: meta.leadId ?? null, businessId: meta.businessId ?? null, repId: meta.repId ?? null } });
    if (meta.push) await sendCrmPush({ title, body: body ?? "", url: href ?? "/admin/crm?tab=alerts", tag: `crm-${n.id}` });
  } catch (e) {
    console.error("[crm-notify]", e);
  }
}

/** Is there at least one phone that gets the CRM's pushes? (Otherwise WhatsApp stays the fallback.) */
export async function crmPushEnabled(): Promise<boolean> {
  const biz = await prisma.business.findUnique({ where: { id: PLATFORM_BUSINESS_ID }, select: { settings: true } }).catch(() => null);
  return subsOf(parse(biz?.settings)).length > 0;
}

/** Push to the CRM app(s). Short by design: a title and one line. Never throws. */
export async function sendCrmPush(p: { title: string; body: string; url: string; tag?: string }): Promise<number> {
  try {
    const biz = await prisma.business.findUnique({ where: { id: PLATFORM_BUSINESS_ID }, select: { settings: true } });
    const s = parse(biz?.settings);
    const subs = subsOf(s);
    const key = typeof s.vapidPrivateKey === "string" && s.vapidPrivateKey ? s.vapidPrivateKey : process.env.VAPID_PRIVATE_KEY;
    if (!subs.length || !key) return 0;
    webpush.setVapidDetails("mailto:yair9051@gmail.com", VAPID_PUBLIC_KEY, key);
    const payload = JSON.stringify({ title: p.title.slice(0, 80), body: p.body.slice(0, 120), url: p.url, tag: p.tag });
    const dead: string[] = [];
    let sent = 0;
    await Promise.all(subs.map(async sub => {
      try { await webpush.sendNotification(sub as webpush.PushSubscription, payload); sent++; }
      catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) dead.push(sub.endpoint); }
    }));
    if (dead.length) await saveSubs(subs.filter(x => !dead.includes(x.endpoint)));
    return sent;
  } catch (e) {
    console.error("[crm-push]", e);
    return 0;
  }
}

async function saveSubs(subs: WebPushSub[]): Promise<void> {
  const biz = await prisma.business.findUnique({ where: { id: PLATFORM_BUSINESS_ID }, select: { settings: true } });
  const s = parse(biz?.settings);
  s.crmWebPushSubs = subs.slice(-10);
  await prisma.business.update({ where: { id: PLATFORM_BUSINESS_ID }, data: { settings: JSON.stringify(s) } });
}

export async function addCrmPushSub(sub: WebPushSub): Promise<void> {
  const biz = await prisma.business.findUnique({ where: { id: PLATFORM_BUSINESS_ID }, select: { settings: true } });
  await saveSubs([...subsOf(parse(biz?.settings)).filter(x => x.endpoint !== sub.endpoint), sub]);
}

export async function removeCrmPushSub(endpoint: string): Promise<void> {
  const biz = await prisma.business.findUnique({ where: { id: PLATFORM_BUSINESS_ID }, select: { settings: true } });
  await saveSubs(subsOf(parse(biz?.settings)).filter(x => x.endpoint !== endpoint));
}

export async function crmPushHas(endpoint: string): Promise<boolean> {
  const biz = await prisma.business.findUnique({ where: { id: PLATFORM_BUSINESS_ID }, select: { settings: true } });
  return subsOf(parse(biz?.settings)).some(x => x.endpoint === endpoint);
}

export async function crmPushDevices(): Promise<number> {
  const biz = await prisma.business.findUnique({ where: { id: PLATFORM_BUSINESS_ID }, select: { settings: true } });
  return subsOf(parse(biz?.settings)).length;
}

/** Minute cron: one push 10 minutes before each booked call of Yair's (other reps get it on WhatsApp). */
export async function remindUpcomingCalls(now: Date = new Date()): Promise<number> {
  const calls = await prisma.salesCall.findMany({
    where: { status: "booked", remindedAt: null, startsAt: { gt: new Date(now.getTime() + 2 * 60_000), lte: new Date(now.getTime() + 11 * 60_000) } },
    select: { id: true, leadId: true, repId: true, startsAt: true },
  });
  if (!calls.length) return 0;
  const [leads, reps] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: calls.map(c => c.leadId) } }, select: { id: true, name: true, phone: true, businessName: true } }),
    prisma.salesRep.findMany({ where: { id: { in: calls.map(c => c.repId) } }, select: { id: true, isOwner: true, phone: true } }),
  ]);
  for (const c of calls) {
    const claimed = await prisma.salesCall.updateMany({ where: { id: c.id, remindedAt: null }, data: { remindedAt: now } });
    if (!claimed.count) continue;
    const l = leads.find(x => x.id === c.leadId);
    const mins = Math.max(1, Math.round((c.startsAt.getTime() - now.getTime()) / 60_000));
    const title = `📞 בעוד ${mins} דק׳: ${l?.name || l?.phone || "ליד"}`;
    const body = [l?.businessName, l?.phone?.replace(/^972/, "0")].filter(Boolean).join(" · ");
    const rep = reps.find(r => r.id === c.repId);
    if (!rep || rep.isOwner) {
      // No phone has the CRM pushes on yet → the reminder still reaches him, on WhatsApp.
      if (!(await sendCrmPush({ title, body, url: `/admin/crm/leads/${c.leadId}`, tag: `call-${c.id}` }))) {
        const { notifyPlatformOwner } = await import("@/lib/super-admin");
        await notifyPlatformOwner(`${title}\n${body}`);
      }
    }
    else if (rep.phone) {
      const { enqueueMessage } = await import("@/lib/messaging");
      const { normalizeIsraeliPhone } = await import("@/lib/messaging/phone");
      const { DEMO_BUSINESS_ID } = await import("@/lib/demo-widget");
      await enqueueMessage({ businessId: DEMO_BUSINESS_ID, customerPhone: normalizeIsraeliPhone(rep.phone), kind: "crm_rep_alert", body: `${title}\n${body}`, scheduledFor: now }).catch(() => {});
    }
  }
  return calls.length;
}
