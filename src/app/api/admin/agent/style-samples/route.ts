import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBusiness, requireOwner } from "@/lib/session";

/**
 * How the owner really writes to customers (16.10.2026, Yair: "לגבי דוגמאות
 * לשיחות אני לא חושב שמישהו הולך לייצא שיחות"): his own replies are already
 * here, sent from the app or from his phone. Only a reply right after a
 * customer's message counts; wording that repeats across chats is an
 * automation (reminders, "ראיתי שלא קבעת"), not his voice.
 */
export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });
  const msgs = await prisma.conversationMessage.findMany({
    where: { role: { in: ["user", "assistant"] }, createdAt: { gte: new Date(Date.now() - 90 * 86400_000) }, conversation: { businessId: biz.id, agentType: { not: "owner" } } },
    orderBy: [{ conversationId: "asc" }, { createdAt: "asc" }], take: 4000,
    select: { conversationId: true, role: true, source: true, content: true, createdAt: true },
  });
  // Wording seen in two chats or more is a template.
  const head = (t: string) => t.replace(/\s+/g, " ").trim().split(" ").slice(0, 4).join(" ");
  const chatsByHead = new Map<string, Set<string>>();
  for (const m of msgs) if (m.role === "assistant" && m.source === "admin") { const h = head(m.content); chatsByHead.set(h, (chatsByHead.get(h) ?? new Set()).add(m.conversationId)); }
  const picks: string[] = [];
  const seen = new Set<string>();
  for (let i = msgs.length - 1; i > 0 && picks.length < 6; i--) {
    const m = msgs[i], prev = msgs[i - 1];
    if (m.role !== "assistant" || m.source !== "admin" || prev.conversationId !== m.conversationId || prev.role !== "user") continue;
    if (m.createdAt.getTime() - prev.createdAt.getTime() > 3 * 3600_000) continue;
    const t = m.content.replace(/\s+/g, " ").trim();
    if (t.length < 8 || t.length > 220 || /https?:\/\/|www\./i.test(t)) continue;
    const h = head(t);
    if ((chatsByHead.get(h)?.size ?? 0) > 1 || seen.has(h)) continue;
    seen.add(h);
    picks.push(t);
  }
  return NextResponse.json({ samples: picks });
}
