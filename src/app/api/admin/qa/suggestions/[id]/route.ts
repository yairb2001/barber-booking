import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";

// POST /api/admin/qa/suggestions/[id]  body: { action: "approve" | "reject" | "undo" }
//
// approve:
//   • prompt fix → append proposedFix to the live agent prompt (backing up the
//     previous prompt for one-tap undo), status → applied.
//   • code/data  → can't be safely applied from here → status → flagged (routes
//     to a developer).
// reject: status → rejected.
// undo:   restore the backed-up prompt, status → pending (only for applied prompt fixes).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;

  const action = (await req.json().catch(() => ({})))?.action as string | undefined;
  if (!["approve", "reject", "undo"].includes(action || "")) {
    return NextResponse.json({ error: "action לא תקין" }, { status: 400 });
  }

  const sug = await prisma.qaSuggestion.findUnique({ where: { id: params.id } });
  if (!sug || sug.businessId !== session.businessId) {
    return NextResponse.json({ error: "הצעה לא נמצאה" }, { status: 404 });
  }

  // ── reject ──
  if (action === "reject") {
    if (sug.status !== "pending") return NextResponse.json({ error: "כבר טופל" }, { status: 409 });
    const updated = await prisma.qaSuggestion.update({
      where: { id: sug.id }, data: { status: "rejected", resolvedAt: new Date() },
    });
    return NextResponse.json({ ok: true, suggestion: updated });
  }

  // ── undo (revert an applied prompt fix) ──
  if (action === "undo") {
    if (sug.status !== "applied" || sug.klass !== "prompt" || sug.promptBefore == null) {
      return NextResponse.json({ error: "אין מה לבטל" }, { status: 409 });
    }
    await prisma.agentConfig.update({
      where: { businessId: sug.businessId },
      data: { systemPrompt: sug.promptBefore },
    });
    const updated = await prisma.qaSuggestion.update({
      where: { id: sug.id }, data: { status: "pending", resolvedAt: null },
    });
    return NextResponse.json({ ok: true, suggestion: updated, reverted: true });
  }

  // ── approve ──
  if (sug.status !== "pending") return NextResponse.json({ error: "כבר טופל" }, { status: 409 });

  // Only prompt fixes are safe to apply from the panel. Code/data changes need a
  // developer + deploy — approving them just flags them (nothing is auto-applied).
  if (sug.klass !== "prompt" || !sug.proposedFix?.trim()) {
    const updated = await prisma.qaSuggestion.update({
      where: { id: sug.id }, data: { status: "flagged", resolvedAt: new Date() },
    });
    return NextResponse.json({ ok: true, suggestion: updated, flagged: true });
  }

  const cfg = await prisma.agentConfig.findUnique({
    where: { businessId: sug.businessId }, select: { systemPrompt: true },
  });
  // We only append to an existing custom prompt. If none is set the agent runs on
  // the built-in default, and appending here would silently drop it — so flag instead.
  if (!cfg?.systemPrompt?.trim()) {
    const updated = await prisma.qaSuggestion.update({
      where: { id: sug.id }, data: { status: "flagged", resolvedAt: new Date() },
    });
    return NextResponse.json({ ok: true, suggestion: updated, flagged: true, reason: "no_custom_prompt" });
  }

  const before = cfg.systemPrompt;
  const newPrompt = `${before}\n\n${sug.proposedFix.trim()}`;
  await prisma.agentConfig.update({
    where: { businessId: sug.businessId }, data: { systemPrompt: newPrompt },
  });
  const updated = await prisma.qaSuggestion.update({
    where: { id: sug.id },
    data: { status: "applied", promptBefore: before, resolvedAt: new Date() },
  });
  return NextResponse.json({ ok: true, suggestion: updated, applied: true });
}
