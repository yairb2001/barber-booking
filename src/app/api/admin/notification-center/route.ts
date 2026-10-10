import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";
import { answerQuestion } from "@/lib/agent/learn";

export const dynamic = "force-dynamic";

/**
 * The shop's notification center (10.10.2026). Owner = rows with no staffId;
 * a barber = his own rows. Open questions of the agent (owner only) come with
 * what is needed to answer them in place. Bookings / cancellations / waitlist
 * keep coming from the older derived feed (/api/admin/notifications), which the
 * screen merges in.
 */
function scope(req: NextRequest) {
  const s = getRequestSession(req);
  if (!s) return null;
  const owner = s.isOwner || !s.staffId;
  return { s, owner, where: { businessId: s.businessId, staffId: owner ? null : s.staffId } };
}

export async function GET(req: NextRequest) {
  const sc = scope(req);
  if (!sc) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const countOnly = new URL(req.url).searchParams.get("count") === "1";
  const unread = await prisma.businessNotification.count({ where: { ...sc.where, readAt: null } });
  if (countOnly) return NextResponse.json({ unread });
  const [rows, questions] = await Promise.all([
    prisma.businessNotification.findMany({ where: { ...sc.where, createdAt: { gte: new Date(Date.now() - 60 * 86400_000) } }, orderBy: { createdAt: "desc" }, take: 150 }),
    sc.owner ? prisma.agentQuestion.findMany({ where: { businessId: sc.s.businessId, status: "open" }, orderBy: { createdAt: "desc" }, take: 30 }) : Promise.resolve([]),
  ]);
  return NextResponse.json({
    unread,
    items: rows.map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, at: r.createdAt, read: !!r.readAt, done: !!r.doneAt, questionId: (() => { try { return r.meta ? (JSON.parse(r.meta).questionId ?? null) : null; } catch { return null; } })() })),
    questions: questions.map(q => ({ id: q.id, question: q.question, customerName: q.customerName, customerPhone: q.customerPhone.replace(/^972/, "0"), at: q.createdAt })),
  });
}

export async function POST(req: NextRequest) {
  const sc = scope(req);
  if (!sc) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (b.action === "read" && typeof b.id === "string") {
    await prisma.businessNotification.updateMany({ where: { ...sc.where, id: b.id, readAt: null }, data: { readAt: new Date() } });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "readAll") {
    await prisma.businessNotification.updateMany({ where: { ...sc.where, readAt: null }, data: { readAt: new Date() } });
    return NextResponse.json({ ok: true });
  }
  if (!sc.owner) return NextResponse.json({ error: "רק בעל העסק עונה על שאלות הסוכן" }, { status: 403 });
  if (b.action === "answer" && typeof b.questionId === "string") {
    const r = await answerQuestion({ businessId: sc.s.businessId, questionId: b.questionId, answer: String(b.answer ?? ""), save: b.save !== false, by: "owner" });
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
  }
  if (b.action === "dismiss" && typeof b.questionId === "string") {
    await prisma.agentQuestion.updateMany({ where: { id: b.questionId, businessId: sc.s.businessId, status: "open" }, data: { status: "dismissed" } });
    await prisma.businessNotification.updateMany({ where: { businessId: sc.s.businessId, kind: "agent_question", meta: { contains: b.questionId } }, data: { doneAt: new Date(), readAt: new Date() } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
}
