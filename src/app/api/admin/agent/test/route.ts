import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { requireOwner, getRequestSession, getSessionBusiness } from "@/lib/session";

export const dynamic = "force-dynamic";

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
