/**
 * Agent Gateway — a single authenticated entry point for an EXTERNAL AI agent
 * (e.g. the owner's "CEO" bot on a Telegram server) to control the business.
 *
 * This is intentionally a small, stable contract instead of exposing the whole
 * ~60-endpoint admin REST surface: the external agent discovers the tool catalog
 * with GET, then runs one tool per POST. It reuses the SAME tools the WhatsApp
 * owner agent uses (src/lib/agent/owner-agent.ts) so there's one source of truth.
 *
 * Auth: a per-business bearer token `agt_<businessId>_<secret>`. Only the secret
 * half is compared (bcrypt) against `settings.agentGatewayTokenHash`, which the
 * owner generates in Settings. Revoke = clear the hash. This route is PUBLIC as
 * far as the middleware is concerned (it's outside /api/admin) and authenticates
 * itself here, so no admin session/cookie is involved.
 *
 * Scope: full business-wide (staffId = null) — the CEO agent is not limited to a
 * single barber's calendar.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { OWNER_TOOLS, execOwnerTool } from "@/lib/agent/owner-agent";

// CORS: allow the external agent's server to call from anywhere. Auth is by
// bearer token, not by origin, so a permissive CORS policy is safe here.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Resolve + verify the bearer token → the business it grants access to.
 * Returns the businessId on success, or a NextResponse (401) to return as-is.
 */
async function authenticate(
  req: NextRequest
): Promise<{ businessId: string; businessName: string } | NextResponse> {
  const header = req.headers.get("authorization") || "";
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw) return json({ error: "missing bearer token" }, 401);

  // Token shape: agt_<businessId>_<secret>. businessId (cuid/uuid) has no "_" and
  // the secret is hex, so a 3-part split is unambiguous.
  const parts = raw.split("_");
  if (parts.length !== 3 || parts[0] !== "agt") {
    return json({ error: "invalid token format" }, 401);
  }
  const [, businessId, secret] = parts;

  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { name: true, settings: true },
  });
  if (!biz) return json({ error: "invalid token" }, 401);

  let tokenHash: string | null = null;
  try {
    const s = biz.settings ? JSON.parse(biz.settings) : {};
    if (typeof s.agentGatewayTokenHash === "string") tokenHash = s.agentGatewayTokenHash;
  } catch { /* ignore */ }
  if (!tokenHash) return json({ error: "gateway not enabled for this business" }, 401);

  const ok = await verifyPassword(secret, tokenHash);
  if (!ok) return json({ error: "invalid token" }, 401);

  return { businessId, businessName: biz.name };
}

/** GET → tool catalog (so the external agent can discover capabilities). */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (auth instanceof NextResponse) return auth;

  return json({
    ok: true,
    business: auth.businessName,
    scope: "business-wide",
    tools: OWNER_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    })),
    usage: {
      run: "POST /api/agent/gateway with { tool, input }",
      auth: "Authorization: Bearer agt_<businessId>_<secret>",
    },
  });
}

/** POST { tool, input } → run one tool business-wide, return its text result. */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (auth instanceof NextResponse) return auth;

  let body: { tool?: unknown; input?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const tool = typeof body.tool === "string" ? body.tool : "";
  if (!tool) return json({ error: "missing 'tool'" }, 400);
  if (!OWNER_TOOLS.some(t => t.name === tool)) {
    return json({ error: `unknown tool: ${tool}`, available: OWNER_TOOLS.map(t => t.name) }, 400);
  }
  const input = (body.input && typeof body.input === "object" ? body.input : {}) as Record<string, unknown>;

  try {
    // staffId = null → full business-wide access (not scoped to one calendar).
    const result = await execOwnerTool(tool, input, auth.businessId, null);
    return json({ ok: true, tool, result });
  } catch (e) {
    console.error("[agent-gateway] tool error", tool, e);
    return json({ ok: false, tool, error: "tool execution failed" }, 500);
  }
}
