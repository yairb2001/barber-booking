import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness, requireOwner, getEffectivePermissions } from "@/lib/session";
import { canAccessConversation } from "@/lib/chat-access";
import { recordCrmNotification } from "@/lib/crm/notify";
import { REPORT_REASONS } from "@/lib/agent/report-reasons";

export const dynamic = "force-dynamic";
// Room for the one model call that sorts a report right away.
export const maxDuration = 30;

/**
 * "What I didn't like about the agent" (10.10.2026). The owner writes it in
 * the agent tab, optionally about one conversation; the daily review reads it
 * with that conversation, and Yair sees it in the CRM. Nothing changes in the
 * agent before he approves a fix.
 *
 * From inside a chat (25.10.2026, Yair: "אני רוצה דיווח על צ'אט מסוים, ואז אני
 * יכול לבחור איזה הודעות לא אהבתי, ולהסביר מה לא אהבתי בהם"): "דווח על השיחה"
 * sends one report for the chat, with the agent messages he marked and what was
 * wrong in each (items), from the owner or a team member who can see the chat.
 * The marked ids are kept comma separated in message_id. It is sorted at once
 * (merged with the same problem or a new one) and Yair gets a push; when the fix
 * goes live the shop hears it (closeReports).
 */
export async function GET(req: NextRequest) {
  // The agent messages already reported in one chat, to mark them in the thread.
  const convId = req.nextUrl.searchParams.get("conversationId");
  if (convId) {
    const biz = await getSessionBusiness(req, { id: true });
    if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
    if (!(await canReport(req, biz.id, convId))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const rows = await prisma.agentFeedback.findMany({ where: { businessId: biz.id, conversationId: convId, messageId: { not: null } }, select: { messageId: true, status: true } });
    return NextResponse.json({ reported: rows.flatMap(r => (r.messageId ?? "").split(",").filter(Boolean).map(messageId => ({ messageId, status: r.status }))) });
  }
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  const [items, convs] = await Promise.all([
    prisma.agentFeedback.findMany({ where: { businessId: biz.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.conversation.findMany({
      where: { businessId: biz.id, agentType: { not: "owner" }, NOT: { phone: { startsWith: "972000" } }, messages: { some: { role: "assistant", source: "agent" } } },
      orderBy: { lastMessageAt: "desc" }, take: 25,
      select: { id: true, phone: true, whatsappName: true, lastMessageAt: true, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true } } },
    }),
  ]);
  const phones = convs.map(c => c.phone);
  const customers = await prisma.customer.findMany({ where: { businessId: biz.id, phone: { in: [...phones, ...phones.map(p => p.replace(/^972/, "0"))] } }, select: { phone: true, name: true } });
  const nameOf = (p: string) => customers.find(c => c.phone === p || c.phone === p.replace(/^972/, "0"))?.name;
  return NextResponse.json({
    items: items.map(f => ({ id: f.id, text: f.text, status: f.status, at: f.createdAt, conversationId: f.conversationId })),
    conversations: convs.map(c => ({ id: c.id, name: nameOf(c.phone) || c.whatsappName || c.phone.replace(/^972/, "0"), at: c.lastMessageAt, last: c.messages[0]?.content?.slice(0, 80) ?? "" })),
  });
}

/** The owner, or a team member who can see this chat. */
async function canReport(req: NextRequest, businessId: string, conversationId: string): Promise<boolean> {
  const s = getRequestSession(req);
  if (!s) return false;
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, businessId }, select: { id: true } });
  if (!conv) return false;
  if (s.isOwner) return true;
  return canAccessConversation(await getEffectivePermissions(req), businessId, conversationId);
}

export async function POST(req: NextRequest) {
  const s = getRequestSession(req);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const biz = await getSessionBusiness(req, { id: true, name: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const pickReasons = (x: unknown): string[] => (Array.isArray(x) ? x.filter((r: unknown): r is string => typeof r === "string" && (REPORT_REASONS as readonly string[]).includes(r)) : []);
  const words = (x: unknown) => (typeof x === "string" ? x.trim().slice(0, 1000) : "");

  let conversationId: string | null = null;
  let messageId: string | null = null;
  const lines: string[] = [];
  if (typeof b.conversationId === "string" && b.conversationId) {
    if (!(await canReport(req, biz.id, b.conversationId))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    conversationId = b.conversationId;
    // The agent messages he marked, each with what was wrong in it, in the chat's order.
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 20) as { messageId?: unknown; reasons?: unknown; text?: unknown }[];
    const ids = items.map(i => (typeof i.messageId === "string" ? i.messageId : "")).filter(Boolean);
    const msgs = ids.length ? await prisma.conversationMessage.findMany({ where: { id: { in: ids }, conversationId: b.conversationId, role: "assistant" }, orderBy: { createdAt: "asc" }, select: { id: true, content: true } }) : [];
    for (const m of msgs) {
      const it = items.find(i => i.messageId === m.id)!;
      const why = [pickReasons(it.reasons).join(", "), words(it.text)].filter(Boolean).join(". ");
      lines.push(`על התשובה «${m.content.replace(/\s+/g, " ").slice(0, 160)}»: ${why || "לא אהבתי"}`);
    }
    messageId = msgs.map(m => m.id).join(",") || null;
  } else if (!s.isOwner) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const general = [pickReasons(b.reasons).join(", "), words(b.text)].filter(Boolean).join(": ");
  if (general) lines.push(lines.length ? `ובכללי: ${general}` : general);
  const text = lines.join("\n").slice(0, 3000);
  if (!text) return NextResponse.json({ error: "סמן הודעה או כתוב מה לא היה בסדר" }, { status: 400 });

  const staff = s.staffId ? await prisma.staff.findUnique({ where: { id: s.staffId }, select: { name: true } }) : null;
  const author = s.isOwner ? "בעל העסק" : staff?.name || "מהצוות";
  const fb = await prisma.agentFeedback.create({ data: { businessId: biz.id, staffId: s.staffId ?? null, author, conversationId, messageId, text } });

  // Sorted now, not the next morning: merged with the same open problem or a new one.
  // If the model is slow, the daily run picks it up (it stays "new").
  try {
    const { reviewReports } = await import("@/lib/agent/daily-review");
    await Promise.race([reviewReports(new Date(), { ids: [fb.id], notify: false }), new Promise(r => setTimeout(r, 20_000))]);
  } catch (e) { console.error("[feedback] sort", fb.id, e); }
  await recordCrmNotification(`${biz.name}: דיווח על הסוכן${messageId ? " מתוך צ'אט" : ""}\n${text.slice(0, 160)}`, { kind: "customer", businessId: biz.id, href: "/admin/crm/improvements", push: true });
  // And whoever runs the reports screen (Nika), on her own phone.
  const { pushReportsMembers } = await import("@/lib/crm/member-push");
  await pushReportsMembers({ title: `דיווח חדש מ${biz.name}`, body: text.replace(/^על התשובה «.*?»: /, "").split("\n")[0].slice(0, 100), url: "/admin/crm/reports", tag: `report-${fb.id}` });
  return NextResponse.json({ ok: true, id: fb.id });
}
