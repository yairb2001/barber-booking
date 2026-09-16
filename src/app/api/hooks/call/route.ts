/**
 * POST /api/hooks/call — the shop phone (MacroDroid) or a telephony webhook
 * reports a call to the shop's number. Authenticated by the business's own
 * call-hook secret (header `x-call-secret`, or `?secret=`), which also
 * identifies the business. See specs/call-automation.md §2.
 *
 * Body: { phone, direction?: "in"|"out", outcome: "answered"|"missed", at?: ISO, durationSec?: number, device?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleCallEvent } from "@/lib/automations/call-events";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-call-secret") || req.nextUrl.searchParams.get("secret") || "";
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const biz = await prisma.business.findUnique({ where: { callHookSecret: secret }, select: { id: true } });
  if (!biz) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* MacroDroid can send form-encoded */ }
  if (!Object.keys(body).length) {
    try { const form = await req.formData(); form.forEach((v, k) => { body[k] = String(v); }); } catch { /* ignore */ }
  }
  const phone = String(body.phone ?? body.number ?? "").trim();
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
  const direction = body.direction === "out" ? "out" : "in";
  const rawOutcome = String(body.outcome ?? "").toLowerCase();
  const outcome = rawOutcome === "missed" || rawOutcome === "answered" ? rawOutcome : (Number(body.durationSec ?? 0) > 0 ? "answered" : "missed");
  const at = body.at ? new Date(String(body.at)) : new Date();
  const result = await handleCallEvent({
    businessId: biz.id, phone, direction, outcome,
    at: isNaN(at.getTime()) ? new Date() : at,
    durationSec: Math.max(0, Math.round(Number(body.durationSec ?? 0)) || 0),
    device: body.device ? String(body.device).slice(0, 40) : null,
  });
  return NextResponse.json({ ok: true, case: result.case, sent: result.sent, reason: result.reason });
}
