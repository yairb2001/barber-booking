/**
 * The shop's notification center (10.10.2026, Yair: "מסך שכל הפוש וההתראות
 * יהיו בו ... ובהגדרות כל אחד יכול לבחור איך יגיעו אליו ההתראות: וואטסאפ או
 * פוש למסך הזה"). Every event for the shop is written here first (the
 * "התראות" tab); then each recipient gets it the way they chose for that kind:
 * push (opens the tab), WhatsApp (the caller sends it, as before), or screen
 * only. Never throws into the caller.
 */
import { prisma } from "@/lib/prisma";
import { notifyOwnerWeb, notifyStaffWeb } from "@/lib/native/web-push";
import { pushToOwner, pushToStaff } from "@/lib/native/push";
import { channelFor, type CenterKind, type Channel } from "@/lib/notify/kinds";

export type { CenterKind, Channel } from "@/lib/notify/kinds";

export async function centerNotify(p: {
  businessId: string;
  /** null/undefined = the owner. */
  staffId?: string | null;
  kind: CenterKind;
  title: string;
  body?: string | null;
  /** Where tapping it leads; defaults to the notification center. */
  href?: string | null;
  meta?: Record<string, unknown> | null;
  /** Barber the event is about (honors the owner's "only mine" scope for push). */
  eventStaffId?: string | null;
  /** Do not push even if chosen (the caller pushes itself). */
  noPush?: boolean;
}): Promise<{ id: string | null; channel: Channel }> {
  let channel: Channel = "screen";
  try {
    const settings = p.staffId
      ? (await prisma.staff.findUnique({ where: { id: p.staffId }, select: { settings: true } }))?.settings
      : (await prisma.business.findUnique({ where: { id: p.businessId }, select: { settings: true } }))?.settings;
    channel = channelFor(settings ?? null, p.kind);
    const row = await prisma.businessNotification.create({
      data: { businessId: p.businessId, staffId: p.staffId ?? null, kind: p.kind, title: p.title.slice(0, 200), body: p.body?.slice(0, 4000) ?? null, href: p.href ?? null, meta: p.meta ? JSON.stringify(p.meta) : null },
      select: { id: true },
    });
    if (channel === "push" && !p.noPush) {
      const url = p.href ?? "/admin/notifications";
      const payload = { title: p.title, body: p.body ?? "", url, tag: `center-${row.id}` };
      if (p.staffId) {
        await notifyStaffWeb(p.staffId, "center", payload).catch(() => {});
        await pushToStaff(p.staffId, { title: p.title, body: p.body ?? "", data: { type: p.kind, url } }).catch(() => {});
      } else {
        await notifyOwnerWeb(p.businessId, "center", payload, p.eventStaffId).catch(() => {});
        await pushToOwner(p.businessId, { title: p.title, body: p.body ?? "", data: { type: p.kind, url } }, p.eventStaffId).catch(() => {});
      }
    }
    return { id: row.id, channel };
  } catch (e) {
    console.error("[center] notify failed", e);
    return { id: null, channel };
  }
}

/** A report: always in the center; true when it should ALSO go by WhatsApp (the default, as before). */
export async function reportToCenter(p: { businessId: string; staffId?: string | null; title: string; body: string }): Promise<boolean> {
  const r = await centerNotify({ businessId: p.businessId, staffId: p.staffId ?? null, kind: "report", title: p.title, body: p.body });
  return r.channel === "whatsapp";
}
