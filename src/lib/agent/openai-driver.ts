/**
 * OpenAI (GPT) driver for the customer agent — an A/B alternative to the
 * Anthropic loop in customer-agent.ts. Selected per-business via
 * settings.aiProvider === "openai". The Claude path is left completely
 * untouched: this file is a parallel implementation that reuses the SAME tool
 * definitions, the SAME execTool, the SAME system prompt and the SAME dialogue
 * history, only translated into OpenAI's chat-completions wire format.
 *
 * Why a separate driver (not a shared adapter): the whole point of the
 * experiment is "swap the brain without risking the working one". Keeping the
 * two loops physically separate means switching back to Claude is a flag flip
 * with zero chance of regression.
 *
 * No new npm dependency — we call the REST API directly with fetch, honoring the
 * project's intentionally small dep list. Needs OPENAI_API_KEY in the env.
 */

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

// Tools and execTool are passed in from customer-agent.ts (rather than imported)
// to avoid a circular module dependency — both modules stay independently loadable.
type ExecTool = (
  name: string,
  input: Record<string, string>,
  bizId: string,
  conversationId: string,
  callerPhone: string,
) => Promise<string>;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// Translate the Anthropic-shaped tool defs into OpenAI function tools. Both use
// JSON Schema for parameters, so input_schema maps straight onto parameters.
function toOpenAiTools(tools: Anthropic.Tool[]) {
  return tools.map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

type OpenAiMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/**
 * Runs the GPT tool-calling loop for one incoming turn and returns the final
 * assistant text (bubbles are split by the caller, exactly like the Claude path).
 */
export async function runOpenAiAgentLoop(opts: {
  history: { role: string; content: string }[];
  systemPrompt: string;
  businessId: string;
  conversationId: string;
  phone: string;
  model: string;
  tools: Anthropic.Tool[];
  execTool: ExecTool;
}): Promise<string> {
  const { history, systemPrompt, businessId, conversationId, phone, model, execTool } = opts;
  // Strip any non-printable-ASCII characters from the key. Copy-pasting a secret
  // into a dashboard can silently inject invisible Unicode (e.g. U+2028 LINE
  // SEPARATOR, char 8232) — and since the key goes into the Authorization HTTP
  // header, Node's `new Headers()` throws "Cannot convert argument to a
  // ByteString ... value greater than 255" and the whole turn dies in silence.
  // API keys are pure printable ASCII, so this only ever removes garbage.
  const apiKey = process.env.OPENAI_API_KEY?.replace(/[^\x21-\x7E]/g, "");
  if (!apiKey) {
    console.error("[agent:openai] OPENAI_API_KEY missing — cannot run GPT driver");
    return "";
  }

  const messages: OpenAiMsg[] = [{ role: "system", content: systemPrompt }];
  for (const m of history) {
    const role: "user" | "assistant" = m.role === "user" ? "user" : "assistant";
    const last = messages[messages.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content += "\n" + m.content;
    } else {
      messages.push({ role, content: m.content });
    }
  }

  const tools = toOpenAiTools(opts.tools);
  const MAX_ITERATIONS = 8;
  let assistantText = "";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages,
        tools,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[agent:openai] API ${res.status}: ${body.slice(0, 500)}`);
      break;
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const msg = choice?.message;
    const usage = data.usage ?? {};
    console.log(
      `[agent:openai] model=${model} in=${usage.prompt_tokens ?? 0} out=${usage.completion_tokens ?? 0} ` +
      `cached=${usage.prompt_tokens_details?.cached_tokens ?? 0} finish=${choice?.finish_reason}`
    );
    if (!msg) break;

    const toolCalls: OpenAiToolCall[] = msg.tool_calls ?? [];

    if (toolCalls.length) {
      // Echo the assistant turn (with its tool_calls) before answering them.
      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: toolCalls });

      for (const tc of toolCalls) {
        let input: Record<string, string> = {};
        try { input = JSON.parse(tc.function.arguments || "{}"); }
        catch { console.warn(`[agent:openai] bad tool args for ${tc.function.name}: ${tc.function.arguments}`); }

        const result = await execTool(tc.function.name, input, businessId, conversationId, phone);
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });

        await prisma.conversationMessage.create({
          data: {
            conversationId,
            role: "tool",
            content: result,
            toolName: tc.function.name,
            toolCallId: tc.id,
          },
        });
      }
      continue;
    }

    if (typeof msg.content === "string") assistantText += msg.content;
    break;
  }

  // Safety net: tool budget spent without composing a reply — force one final
  // text-only turn (mirrors the Claude path). Tools omitted so it must answer.
  if (!assistantText.trim()) {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: 1024, messages }),
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      const c = data.choices?.[0]?.message?.content;
      if (typeof c === "string") assistantText += c;
    }
  }

  return assistantText;
}
