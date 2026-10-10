/**
 * The shop's notification center (10.10.2026, Yair: "שם יהיה כל מה שעד כה
 * נשלח אליי לווצאפ"). Every alert that used to reach the owner or a barber by
 * WhatsApp is written here first (the "התראות" tab); then each person gets it
 * the way they chose for that kind: WhatsApp (as before, the default), push
 * to this screen, or the screen only. The owner's own barber row counts as
 * the owner (one person, one set of choices). Never throws into the caller.
 */
import { prisma } from "@/lib/prisma";
import { notifyOwnerWeb, notifyStaffWeb } from "@/lib/native/web-push";
import { pushToOwner, pushToStaff } from "@/lib/native/push";
import { resolveOwnerStaffId } from "@/lib/native/owner-scope";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { channelFor, type CenterKind, type Channel } from "@/lib/notify/kinds";

export type { CenterKind, Channel } from "@/lib/notify/kinds";

/** Who a staff-targeted alert is for: null = the owner (also when it is the owner's own barber row). */
async function recipient(businessId: string, staffId: string | null | undefined): Promise<string | null> {
  if (!staffId) return null;
  const ownerStaff = await resolveOwnerStaffId(businessId).catch(() => null);
  return ownerStaff && ownerStaff === staffId ? null : staffId;
}

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
    const staffId = await recipient(p.businessId, p.staffId);
    const settings = staffId
      ? (await prisma.staff.findUnique({ where: { id: staffId }, select: { settings: true } }))?.settings
      : (await prisma.business.findUnique({ where: { id: p.businessId }, select: { settings: true } }))?.settings;
    channel = channelFor(settings ?? null, p.kind);
    const row = await prisma.businessNotification.create({
      data: { businessId: p.businessId, staffId, kind: p.kind, title: p.title.slice(0, 200), body: p.body?.slice(0, 4000) ?? null, href: p.href ?? null, meta: p.meta ? JSON.stringify(p.meta) : null },
      select: { id: true },
    });
    if (channel === "push" && !p.noPush) {
      const url = p.href ?? "/admin/notifications";
      const payload = { title: p.title, body: (p.body ?? "").split("\n")[0], url, tag: `center-${row.id}` };
      if (staffId) {
        await notifyStaffWeb(staffId, "center", payload).catch(() => {});
        await pushToStaff(staffId, { title: p.title, body: payload.body, data: { type: p.kind, url } }).catch(() => {});
      } else {
        await notifyOwnerWeb(p.businessId, "center", payload, p.eventStaffId).catch(() => {});
        await pushToOwner(p.businessId, { title: p.title, body: payload.body, data: { type: p.kind, url } }, p.eventStaffId).catch(() => {});
      }
    }
    return { id: row.id, channel };
  } catch (e) {
    console.error("[center] notify failed", e);
    return { id: null, channel };
  }
}

/**
 * An alert that used to be a WhatsApp to a barber or the owner: into the
 * center, and the original WhatsApp only if that person chose WhatsApp for
 * this kind. `phone` resolves the barber when only his number is known.
 */
export async function staffAlert(p: {
  businessId: string; staffId?: string | null; phone?: string | null;
  kind: CenterKind; title: string; body: string; href?: string | null; meta?: Record<string, unknown> | null;
  whatsapp: () => Promise<unknown>;
}): Promise<Channel> {
  let staffId = p.staffId ?? null;
  if (!staffId && p.phone) {
    const n = normalizeIsraeliPhone(p.phone);
    const st = await prisma.staff.findFirst({ where: { businessId: p.businessId, OR: [{ phone: n }, { phone: n.replace(/^972/, "0") }] }, select: { id: true } }).catch(() => null);
    staffId = st?.id ?? null;
  }
  const { channel } = await centerNotify({ businessId: p.businessId, staffId, kind: p.kind, title: p.title, body: p.body, href: p.href, meta: p.meta });
  if (channel === "whatsapp") await p.whatsapp();
  return channel;
}

/** A report: always in the center; true when it should ALSO go by WhatsApp (the default, as before). */
export async function reportToCenter(p: { businessId: string; staffId?: string | null; title: string; body: string }): Promise<boolean> {
  const r = await centerNotify({ businessId: p.businessId, staffId: p.staffId ?? null, kind: "report", title: p.title, body: p.body });
  return r.channel === "whatsapp";
}
