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


/**
 * POST /api/admin/agent/test — run one scripted scenario through the REAL agent
 * of this business in sandbox mode: nothing is sent on WhatsApp, mutating tools
 * (book / cancel / escalate…) are simulated, and the throw-away conversation is
 * deleted afterwards. Lets the owner see within seconds whether a prompt change
 * broke something.
 * Body: { scenario: "new_price" | "returning_move" | "unknown" | "custom", messages?: string[] }
 */
const SCENARIOS: Record<string, { label: string; messages: string[] }> = {
  new_price:      { label: "לקוח חדש שואל מחיר",        messages: ["היי כמה עולה תספורת?", "ומתי יש לכם פנוי השבוע?"] },
  returning_move: { label: "לקוח חוזר רוצה להזיז תור",   messages: ["היי, אני רוצה להזיז את התור שלי לשעה מאוחרת יותר"] },
  unknown:        { label: "שאלה שאין עליה תשובה",       messages: ["אתם עושים גם צביעת שיער לנשים? וכמה זה עולה?"] },
};

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const business = await getSessionBusiness(req, { id: true });
  if (!business) return NextResponse.json({ error: "no business" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const scenario = SCENARIOS[body.scenario as string];
  const messages: string[] = scenario ? scenario.messages
    : Array.isArray(body.messages) ? body.messages.filter((m: unknown) => typeof m === "string" && m.trim()).slice(0, 3) : [];
  if (!messages.length) return NextResponse.json({ error: "scenario or messages required" }, { status: 400 });

  // Throw-away phone: never a real number, unique per run.
  const phone = "97250" + String(Date.now()).slice(-7);
  const transcript: { role: "user" | "assistant"; text: string }[] = [];
  const toolLog: string[] = [];
  const { runCustomerAgent } = await import("@/lib/agent/customer-agent");
  try {
    for (const m of messages) {
      transcript.push({ role: "user", text: m });
      const sandbox = { replies: [] as string[], toolLog };
      await runCustomerAgent({ businessId: business.id, phone, incomingText: m, sandbox });
      for (const r of sandbox.replies) transcript.push({ role: "assistant", text: r });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "agent failed", transcript, toolLog }, { status: 500 });
  } finally {
    // Clean up the sandbox conversation so it never shows in the inbox.
    const convs = await prisma.conversation.findMany({ where: { businessId: business.id, phone }, select: { id: true } });
    if (convs.length) {
      await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: convs.map(c => c.id) } } }).catch(() => {});
      await prisma.conversation.deleteMany({ where: { id: { in: convs.map(c => c.id) } } }).catch(() => {});
    }
    await prisma.messageLog.deleteMany({ where: { businessId: business.id, customerPhone: phone } }).catch(() => {});
  }
  return NextResponse.json({ ok: true, label: scenario?.label ?? "תרחיש מותאם", transcript, toolLog });
}
