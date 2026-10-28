/**
 * Who gets the push for a WhatsApp conversation event — the owner's rules:
 *
 *  ESCALATION (a chat now needs a human):
 *    → the customer's regular barber (≥70% of recent visits), only them;
 *    → no regular barber → everyone with inbox access (owner + barbers who can see chats).
 *
 *  REPLY (customer answers in a human-handled chat):
 *    → only the team member(s) who wrote to this customer in the last 24h;
 *    → nobody wrote yet → same rule as escalation.
 *
 * A team member who is the owner is pushed through the owner channel (that is
 * where their subscription lives); everyone else through their staff channel.
 */
import { prisma } from "@/lib/prisma";
import { notifyOwnerWeb, notifyStaffWeb, type NotifyType, type PushPayload } from "@/lib/native/web-push";
import { resolveOwnerStaffId } from "@/lib/native/owner-scope";
import { phoneVariants } from "@/lib/messaging/phone";

const REGULAR_SHARE = 0.7;
const HANDLER_WINDOW_MS = 24 * 3_600_000;

/** Barber who has ≥70% of the customer's last 12 completed visits, if any. */
export async function regularStaffFor(businessId: string, phone: string): Promise<string | null> {
  const todayUTC = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const rows = await prisma.appointment.findMany({
    where: { businessId, customer: { phone: { in: phoneVariants(phone) } }, date: { lt: todayUTC }, status: { notIn: ["cancelled_by_customer", "cancelled_by_staff", "no_show"] } },
    orderBy: { date: "desc" }, take: 12, select: { staffId: true, staff: { select: { isAvailable: true } } },
  });
  if (rows.length < 2) return null;
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.staffId, (counts.get(r.staffId) || 0) + 1);
  const [top, n] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  const active = rows.find(r => r.staffId === top)?.staff?.isAvailable;
  return n / rows.length >= REGULAR_SHARE && active ? top : null;
}

/** Team members who typed a manual reply in this conversation in the last 24h. */
export async function recentHandlers(conversationId: string): Promise<string[]> {
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId, source: "admin", sentByStaffId: { not: null }, createdAt: { gte: new Date(Date.now() - HANDLER_WINDOW_MS) } },
    select: { sentByStaffId: true }, distinct: ["sentByStaffId"],
  });
  return rows.map(r => r.sentByStaffId!).filter(Boolean);
}

/**
 * הספר שהלקוח שייך אליו, בשביל "רק שלי" של הבעלים (28.10.2026): הקבוע, אחרת הספר של
 * התור הקרוב, אחרת של התור האחרון. null = לקוח בלי תורים, והבעלים מקבל עליו התראה.
 */
export async function customerStaffFor(businessId: string, phone: string): Promise<string | null> {
  const regular = await regularStaffFor(businessId, phone).catch(() => null);
  if (regular) return regular;
  const todayUTC = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const where = { businessId, customer: { phone: { in: phoneVariants(phone) } }, status: { notIn: ["cancelled_by_customer", "cancelled_by_staff", "no_show"] } };
  const upcoming = await prisma.appointment.findFirst({ where: { ...where, date: { gte: todayUTC } }, orderBy: [{ date: "asc" }, { startTime: "asc" }], select: { staffId: true } });
  if (upcoming) return upcoming.staffId;
  const last = await prisma.appointment.findFirst({ where: { ...where, date: { lt: todayUTC } }, orderBy: { date: "desc" }, select: { staffId: true } });
  return last?.staffId ?? null;
}

async function pushToPerson(businessId: string, staffId: string, type: NotifyType, payload: PushPayload, ownerStaffId: string | null) {
  if (ownerStaffId && staffId === ownerStaffId) return notifyOwnerWeb(businessId, type, payload);
  return notifyStaffWeb(staffId, type, payload);
}

async function pushToEveryone(businessId: string, type: NotifyType, payload: PushPayload, phone: string) {
  const barbers = await prisma.staff.findMany({ where: { businessId, role: "barber", canViewAllChats: true, isAvailable: true }, select: { id: true } });
  // הבעלים דרך "רק שלי": לקוח של ספר אחר לא מגיע אליו (28.10.2026).
  const custStaff = await customerStaffFor(businessId, phone).catch(() => null);
  await Promise.all([
    notifyOwnerWeb(businessId, type, payload, custStaff),
    ...barbers.map(b => notifyStaffWeb(b.id, type, payload)),
  ]);
}

export async function pushChatEvent(opts: {
  businessId: string; conversationId: string; phone: string;
  event: "escalation" | "reply"; payload: PushPayload;
  /** הספר שהשיחה שלו כבר ידוע (בקשת נציג אצל ספר מסוים): רק הוא מקבל, כמו ספר קבוע. */
  staffId?: string | null;
}): Promise<{ to: "handlers" | "regular" | "everyone"; staffIds: string[] }> {
  const { businessId, conversationId, phone, event, payload } = opts;
  const type: NotifyType = event === "escalation" ? "escalation" : "reply";
  const ownerStaffId = await resolveOwnerStaffId(businessId).catch(() => null);

  if (event === "reply") {
    const handlers = await recentHandlers(conversationId);
    if (handlers.length) {
      await Promise.all(handlers.map(id => pushToPerson(businessId, id, type, payload, ownerStaffId).catch(() => {})));
      return { to: "handlers", staffIds: handlers };
    }
  }
  const regular = opts.staffId ?? await regularStaffFor(businessId, phone).catch(() => null);
  if (regular) {
    await pushToPerson(businessId, regular, type, payload, ownerStaffId).catch(() => {});
    return { to: "regular", staffIds: [regular] };
  }
  await pushToEveryone(businessId, type, payload, phone).catch(() => {});
  return { to: "everyone", staffIds: [] };
}
