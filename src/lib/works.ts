import { prisma } from "@/lib/prisma";
import { buildBookingLink } from "@/lib/link-first";
import { phoneVariants } from "@/lib/messaging/phone";
import { getBusinessNow } from "@/lib/utils";
import { worksKey, WANT_PHOTO } from "@/lib/works-shared";

/** Tools whose input names the treatment the customer asked for. */
const SLOT_TOOLS = ["get_available_slots", "find_next_available", "find_visit_times", "find_parallel_slots", "propose_booking", "book_appointment"];

/**
 * After an agent turn about times for a treatment with works on the site: one
 * more bubble with the link to them. Once per treatment per chat. The
 * treatment comes from the slot tools, or from the availability block built
 * for the treatment she named (named), which the agent answers from without a tool.
 */
export async function worksLinkBubble(p: { biz: { id: string; slug: string | null }; conversationId: string; since: Date; named?: string[] }): Promise<string | null> {
  const calls = await prisma.conversationMessage.findMany({
    where: { conversationId: p.conversationId, role: "tool", toolName: { in: SLOT_TOOLS }, createdAt: { gte: p.since } },
    orderBy: { createdAt: "asc" },
    select: { toolInput: true },
  });
  const ids: string[] = [];
  for (const c of calls) {
    try {
      const input = JSON.parse(c.toolInput ?? "{}");
      for (const x of [input, ...(input.treatments ?? []), ...(input.others ?? [])]) {
        if (typeof x?.serviceId === "string" && !ids.includes(x.serviceId)) ids.push(x.serviceId);
      }
    } catch { /* not JSON */ }
  }
  for (const id of p.named ?? []) if (!ids.includes(id)) ids.push(id);
  if (!ids.length) return null;

  const withWorks = await prisma.story.findMany({
    where: { businessId: p.biz.id, serviceId: { in: ids }, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    distinct: ["serviceId"],
    select: { serviceId: true },
  });
  for (const id of ids.filter(i => withWorks.some(w => w.serviceId === i))) {
    const path = `/works?s=${worksKey(id)}`;
    const sent = await prisma.conversationMessage.count({ where: { conversationId: p.conversationId, role: "assistant", content: { contains: path } } });
    if (sent) continue;
    const svc = await prisma.service.findUnique({ where: { id }, select: { name: true } });
    if (!svc) continue;
    return `בינתיים אפשר להציץ בעבודות שלנו ב${svc.name} ולבחור תמונה של מה שבא לך:\n${await buildBookingLink(p.biz)}${path}`;
  }
  return null;
}

/**
 * "כזה אני רוצה" from the works page: the photo goes on the customer's next
 * appointment, so the staff member sees what was asked. With no appointment
 * yet, the agent puts it in the note when it books (propose_booking's note).
 */
export async function attachWantedPhoto(businessId: string, phone: string, text: string): Promise<void> {
  if (!text.startsWith(WANT_PHOTO)) return;
  const wanted = "כמו בתמונה: " + text.slice(WANT_PHOTO.length).trim().replace(/\s+/g, " ");
  const next = await prisma.appointment.findFirst({
    where: {
      businessId,
      customer: { phone: { in: phoneVariants(phone) } },
      date: { gte: new Date(getBusinessNow().date) },
      status: { in: ["confirmed", "pending"] },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { id: true, note: true },
  });
  if (!next || next.note?.includes(wanted)) return;
  await prisma.appointment.update({ where: { id: next.id }, data: { note: next.note ? `${next.note}\n${wanted}` : wanted } });
}
