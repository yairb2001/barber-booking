import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";
import { answerQuestion } from "@/lib/agent/learn";

export const dynamic = "force-dynamic";

/**
 * The shop's notification center (10.10.2026): what used to reach the owner or
 * a barber by WhatsApp. Owner = rows with no staffId (his own barber row maps
 * there too); a barber = his own rows. The agent's open questions (owner) are
 * answered in place, and a request that waits for "כן / לא" (swap, late
 * arrival) is answered with a button, exactly as a WhatsApp reply would.
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
    items: rows.map(r => {
      let m: { questionId?: string; proposalId?: string; ask?: string } = {};
      try { m = r.meta ? JSON.parse(r.meta) : {}; } catch { /* none */ }
      return { id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href, at: r.createdAt, read: !!r.readAt, done: !!r.doneAt, questionId: m.questionId ?? null, ask: m.proposalId && m.ask ? m.ask : null };
    }),
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
  // "מאשר / לא" on a swap or late-arrival request: the same path as the WhatsApp reply.
  if (b.action === "reply" && typeof b.id === "string") {
    const n = await prisma.businessNotification.findFirst({ where: { ...sc.where, id: b.id } });
    if (!n) return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
    if (n.doneAt) return NextResponse.json({ error: "כבר נענה" }, { status: 400 });
    let m: { proposalId?: string } = {};
    try { m = n.meta ? JSON.parse(n.meta) : {}; } catch { /* none */ }
    const proposal = m.proposalId ? await prisma.swapProposal.findFirst({ where: { id: m.proposalId, businessId: sc.s.businessId } }) : null;
    const done = () => prisma.businessNotification.update({ where: { id: n.id }, data: { doneAt: new Date(), readAt: new Date() } });
    if (!proposal || !["pending_staff_approval", "pending_staff_swap_confirm"].includes(proposal.status)) { await done(); return NextResponse.json({ error: "הבקשה כבר לא פתוחה (נענתה או פגה)" }, { status: 400 }); }
    const latest = await prisma.swapProposal.findFirst({ where: { businessId: sc.s.businessId, approvalStaffId: proposal.approvalStaffId, status: { in: ["pending_staff_approval", "pending_staff_swap_confirm"] }, initiatedBy: "agent" }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (latest?.id !== proposal.id) return NextResponse.json({ error: "יש בקשה חדשה יותר מאותו ספר. ענה עליה קודם" }, { status: 409 });
    const staff = proposal.approvalStaffId ? await prisma.staff.findUnique({ where: { id: proposal.approvalStaffId }, select: { phone: true } }) : null;
    if (!staff?.phone) return NextResponse.json({ error: "לספר אין טלפון רשום" }, { status: 400 });
    const { handleStaffApprovalReply } = await import("@/lib/agent/appointment-swap");
    await handleStaffApprovalReply(sc.s.businessId, staff.phone, b.yes === true ? "כן" : "לא");
    await done();
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
