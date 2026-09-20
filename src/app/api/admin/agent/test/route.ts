/**
 * POST /api/admin/agent/test
 *
 * Two modes, both owner-only, both SANDBOX: nothing is sent on WhatsApp,
 * mutating tools (book / cancel / escalate…) are simulated, and the throw-away
 * conversation never shows in the inbox.
 *
 * 1) Scripted scenario (the original owner self-test):
 *    { scenario: "new_price" | "returning_move" | "unknown" | "custom", messages?: string[] }
 *
 * 2) Replay harness (docs/PLAN-COST.md stage B): one customer turn per request so
 *    a real past conversation can be replayed message by message against the
 *    LIVE prompt/tools or the CANDIDATE ones, then compared.
 *    { action: "turn", phone, text, variant?: "live" | "candidate", contextPhone? }
 *      → { replies, toolLog, tools, usage, ms }
 *    { action: "cleanup", phone } → deletes the sandbox conversation.
 *    `phone` must be in the reserved fake range 972000xxxxxxx (never a real number).
 *    `contextPhone` (a real customer) only feeds the customer-context block —
 *    name, history, nudges — the conversation itself is stored under `phone`.
 *    agent_usage rows of replay turns are tagged kind "sandbox".
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { requireOwner, getRequestSession, getSessionBusiness } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // sandbox scenario runs the real agent (Claude calls)

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req);
  const results: Record<string, string> = {};

  // 1. Check API key
  results.api_key = process.env.ANTHROPIC_API_KEY
    ? `set (${process.env.ANTHROPIC_API_KEY.slice(0, 20)}...)`
    : "MISSING";

  // 2. Check DB models
  try {
    const count = await prisma.conversation.count();
    results.conversations_table = `ok (${count} rows)`;
  } catch (e) {
    results.conversations_table = `ERROR: ${e instanceof Error ? e.message : e}`;
  }

  try {
    const cfg = await prisma.agentConfig.findFirst({ where: { businessId: session?.businessId } });
    results.agent_config = cfg
      ? `found: enabled=${cfg.isEnabled}, name="${cfg.agentName}"`
      : "not found (agent not configured)";
  } catch (e) {
    results.agent_config = `ERROR: ${e instanceof Error ? e.message : e}`;
  }

  // 3. Test Anthropic API
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 20,
      messages: [{ role: "user", content: "say hi" }],
    });
    results.anthropic_api = `ok: "${(msg.content[0] as { text: string }).text}"`;
  } catch (e) {
    results.anthropic_api = `ERROR: ${e instanceof Error ? e.message : e}`;
  }

  // 4. Check GreenAPI: is the WhatsApp instance connected, and is the webhook
  //    pointed at us with incoming messages enabled? This is the #1 cause of
  //    "agent enabled but not responding" — incoming messages never reach us.
  try {
    const biz = await getSessionBusiness(req, {
      greenApiInstanceId: true, greenApiToken: true,
    });
    const id = biz?.greenApiInstanceId;
    const token = biz?.greenApiToken;
    if (!id || !token) {
      results.greenapi = "NOT CONFIGURED (missing Instance ID / Token in settings)";
    } else {
      const base = `https://api.green-api.com/waInstance${id}`;
      const expectedWebhook = `${req.nextUrl.origin}/api/webhook/whatsapp`;

      // 4a. Instance state — must be "authorized" (WhatsApp linked)
      try {
        const state = await fetch(`${base}/getStateInstance/${token}`).then(r => r.json());
        results.greenapi_state = state?.stateInstance === "authorized"
          ? "ok (authorized)"
          : `NOT AUTHORIZED: stateInstance="${state?.stateInstance}" — scan the QR in GreenAPI`;
      } catch (e) {
        results.greenapi_state = `ERROR: ${e instanceof Error ? e.message : e}`;
      }

      // 4b. Webhook settings — webhookUrl must point at us + incomingWebhook "yes"
      try {
        const s = await fetch(`${base}/getSettings/${token}`).then(r => r.json());
        const urlOk = s?.webhookUrl === expectedWebhook;
        const incomingOk = s?.incomingWebhook === "yes";
        results.greenapi_webhook = urlOk && incomingOk
          ? "ok (webhook points here + incoming enabled)"
          : `MISCONFIGURED: webhookUrl="${s?.webhookUrl || "(empty)"}" incomingWebhook="${s?.incomingWebhook}" — should be "${expectedWebhook}" + "yes"`;
      } catch (e) {
        results.greenapi_webhook = `ERROR: ${e instanceof Error ? e.message : e}`;
      }
    }
  } catch (e) {
    results.greenapi = `ERROR: ${e instanceof Error ? e.message : e}`;
  }

  return NextResponse.json(results);
}

const SCENARIOS: Record<string, { label: string; messages: string[] }> = {
  new_price:      { label: "לקוח חדש שואל מחיר",        messages: ["היי כמה עולה תספורת?", "ומתי יש לכם פנוי השבוע?"] },
  returning_move: { label: "לקוח חוזר רוצה להזיז תור",   messages: ["היי, אני רוצה להזיז את התור שלי לשעה מאוחרת יותר"] },
  unknown:        { label: "שאלה שאין עליה תשובה",       messages: ["אתם עושים גם צביעת שיער לנשים? וכמה זה עולה?"] },
};

// 972 000 xxx xxxx cannot be a real Israeli number (no subscriber number starts
// with 0) — the earlier 9725099… range collided with real 050‑99 customers.
const SANDBOX_PHONE = /^972000\d{7}$/;

async function cleanupSandbox(businessId: string, phone: string) {
  const convs = await prisma.conversation.findMany({ where: { businessId, phone }, select: { id: true } });
  if (convs.length) {
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: convs.map(c => c.id) } } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { id: { in: convs.map(c => c.id) } } }).catch(() => {});
  }
  await prisma.messageLog.deleteMany({ where: { businessId, customerPhone: phone } }).catch(() => {});
  await prisma.bookingProposal.deleteMany({ where: { businessId, phone } }).catch(() => {});
  // A sandbox turn may have auto-created a Customer (+ implicit waitlist rows)
  // for the fake phone — remove them too, so nothing fake reaches the CRM.
  const fakeCustomers = await prisma.customer.findMany({ where: { businessId, phone: { in: [phone, phone.replace(/^972/, "0")] } }, select: { id: true } });
  if (fakeCustomers.length) {
    const ids = fakeCustomers.map(c => c.id);
    await prisma.waitlist.deleteMany({ where: { customerId: { in: ids } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: ids }, appointments: { none: {} } } }).catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const business = await getSessionBusiness(req, { id: true });
  if (!business) return NextResponse.json({ error: "no business" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const { runCustomerAgent } = await import("@/lib/agent/customer-agent");

  // ── Replay harness ─────────────────────────────────────────────────────────
  if (body.action === "cleanup" || body.action === "turn") {
    const phone = String(body.phone ?? "");
    if (!SANDBOX_PHONE.test(phone)) return NextResponse.json({ error: "phone must be a sandbox number (972000xxxxxxx)" }, { status: 400 });
    if (body.action === "cleanup") { await cleanupSandbox(business.id, phone); return NextResponse.json({ ok: true }); }

    const text = String(body.text ?? "").trim();
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
    const variant = body.variant === "candidate" ? "candidate" : "live";
    const contextPhone = typeof body.contextPhone === "string" && /^972\d{8,9}$/.test(body.contextPhone) ? body.contextPhone : undefined;
    const { DOMINANT_CANDIDATE_PROMPT, AGENT_TOOLS_CANDIDATE } = await import("@/lib/agent/prompt-candidates");
    const sandbox = {
      replies: [] as string[], toolLog: [] as string[], usageKind: "sandbox", contextPhone,
      ...(variant === "candidate" ? { promptOverride: DOMINANT_CANDIDATE_PROMPT, promptVersion: 4 } : {}),
    };
    void AGENT_TOOLS_CANDIDATE; // tool set is chosen by promptVersion (selectTools)
    // Test hook: pretend a rhythm nudge offered these slots to the sandbox phone.
    if (body.seedNudge && Array.isArray(body.seedNudge.options)) {
      const { recordNudgeOffer } = await import("@/lib/agent/booking-proposals");
      await recordNudgeOffer({ businessId: business.id, phone, serviceId: typeof body.seedNudge.serviceId === "string" ? body.seedNudge.serviceId : null, options: body.seedNudge.options });
    }
    const startedAt = new Date();
    try {
      await runCustomerAgent({ businessId: business.id, phone, incomingText: text, sandbox });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "agent failed", replies: sandbox.replies, toolLog: sandbox.toolLog }, { status: 500 });
    }
    const conv = await prisma.conversation.findFirst({ where: { businessId: business.id, phone }, orderBy: { createdAt: "desc" }, select: { id: true } });
    const [tools, usage] = await Promise.all([
      conv ? prisma.conversationMessage.findMany({ where: { conversationId: conv.id, role: "tool", createdAt: { gte: startedAt } }, orderBy: { createdAt: "asc" }, select: { toolName: true, toolInput: true, content: true } }) : [],
      conv ? prisma.agentUsage.findMany({ where: { businessId: business.id, conversationId: conv.id, createdAt: { gte: startedAt } }, select: { model: true, costUsd: true, cacheWriteTokens: true, cacheReadTokens: true, inputTokens: true, outputTokens: true } }) : [],
    ]);
    return NextResponse.json({
      ok: true, variant,
      replies: sandbox.replies, toolLog: sandbox.toolLog,
      tools: tools.map(t => ({ name: t.toolName, input: t.toolInput, result: t.content.slice(0, 160) })),
      usage: {
        calls: usage.length,
        costUsd: usage.reduce((s, u) => s + u.costUsd, 0),
        cacheWrite: usage.reduce((s, u) => s + u.cacheWriteTokens, 0),
        cacheRead: usage.reduce((s, u) => s + u.cacheReadTokens, 0),
        output: usage.reduce((s, u) => s + u.outputTokens, 0),
      },
      ms: Date.now() - startedAt.getTime(),
    });
  }

  // ── Scripted scenario (original) ───────────────────────────────────────────
  const scenario = SCENARIOS[body.scenario as string];
  const messages: string[] = scenario ? scenario.messages
    : Array.isArray(body.messages) ? body.messages.filter((m: unknown) => typeof m === "string" && m.trim()).slice(0, 3) : [];
  if (!messages.length) return NextResponse.json({ error: "scenario or messages required" }, { status: 400 });

  // Throw-away phone: never a real number, unique per run.
  const phone = "97250" + String(Date.now()).slice(-7);
  const transcript: { role: "user" | "assistant"; text: string }[] = [];
  const toolLog: string[] = [];
  try {
    for (const m of messages) {
      transcript.push({ role: "user", text: m });
      const sandbox = { replies: [] as string[], toolLog, usageKind: "sandbox" };
      await runCustomerAgent({ businessId: business.id, phone, incomingText: m, sandbox });
      for (const r of sandbox.replies) transcript.push({ role: "assistant", text: r });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "agent failed", transcript, toolLog }, { status: 500 });
  } finally {
    await cleanupSandbox(business.id, phone);
  }
  return NextResponse.json({ ok: true, label: scenario?.label ?? "תרחיש מותאם", transcript, toolLog });
}
