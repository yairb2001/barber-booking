import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { requireOwner } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
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
    const cfg = await prisma.agentConfig.findFirst();
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

  return NextResponse.json(results);
}
