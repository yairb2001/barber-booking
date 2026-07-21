/**
 * Owner-only management of the Agent Gateway bearer token.
 *
 *   GET    → { enabled, createdAt }  — is a token currently set?
 *   POST   → { token }               — generate a NEW token (invalidates the old
 *                                       one); the raw token is returned ONCE and
 *                                       never stored (only its bcrypt hash is).
 *   DELETE → { ok }                  — revoke: clear the stored hash.
 *
 * The token grants full business-wide control via /api/agent/gateway, so only
 * the owner may mint or revoke it.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";
import { hashPassword } from "@/lib/auth";

async function loadSettings(businessId: string): Promise<Record<string, unknown>> {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { settings: true },
  });
  try {
    return biz?.settings ? JSON.parse(biz.settings) : {};
  } catch {
    return {};
  }
}

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const settings = await loadSettings(session.businessId);
  return NextResponse.json({
    enabled: typeof settings.agentGatewayTokenHash === "string" && !!settings.agentGatewayTokenHash,
    createdAt: settings.agentGatewayTokenSetAt ?? null,
  });
}

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;

  // 32 random bytes → 64 hex chars. The token embeds the businessId so the
  // gateway can resolve the tenant in O(1) before the (constant-time) hash check.
  const secret = randomBytes(32).toString("hex");
  const token = `agt_${session.businessId}_${secret}`;
  const hash = await hashPassword(secret);

  const settings = await loadSettings(session.businessId);
  settings.agentGatewayTokenHash = hash;
  settings.agentGatewayTokenSetAt = new Date().toISOString();

  await prisma.business.update({
    where: { id: session.businessId },
    data: { settings: JSON.stringify(settings) },
  });

  return NextResponse.json({ ok: true, token });
}

export async function DELETE(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;

  const settings = await loadSettings(session.businessId);
  delete settings.agentGatewayTokenHash;
  delete settings.agentGatewayTokenSetAt;

  await prisma.business.update({
    where: { id: session.businessId },
    data: { settings: JSON.stringify(settings) },
  });

  return NextResponse.json({ ok: true });
}
