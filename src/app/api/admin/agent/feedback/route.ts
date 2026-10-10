import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness, requireOwner } from "@/lib/session";
import { recordCrmNotification } from "@/lib/crm/notify";

export const dynamic = "force-dynamic";

/**
 * "What I didn't like about the agent" (10.10.2026). The owner writes it in
 * the agent tab, optionally about one conversation; the daily review reads it
 * with that conversation, and Yair sees it in the CRM. Nothing changes in the
 * agent before he approves a fix.
 */
export async function GET(req: NextRequest) {
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

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true, name: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 2000) : "";
  if (!text) return NextResponse.json({ error: "כתוב מה לא אהבת" }, { status: 400 });
  let conversationId: string | null = null;
  if (typeof b.conversationId === "string" && b.conversationId) {
    const c = await prisma.conversation.findFirst({ where: { id: b.conversationId, businessId: biz.id }, select: { id: true } });
    conversationId = c?.id ?? null;
  }
  const s = getRequestSession(req);
  const fb = await prisma.agentFeedback.create({ data: { businessId: biz.id, staffId: s?.staffId ?? null, author: "בעל העסק", conversationId, text } });
  await recordCrmNotification(`${biz.name} כתב הערה על הסוכן\n${text.slice(0, 160)}`, { kind: "customer", businessId: biz.id, href: "/admin/crm/improvements", push: false });
  return NextResponse.json({ ok: true, id: fb.id });
}
