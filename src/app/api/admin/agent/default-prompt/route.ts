import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { compactAgentBody } from "@/lib/agent/prompt-template";
import { vocabOf } from "@/lib/vocab";
import { prisma } from "@/lib/prisma";
import type { SetupConfig } from "@/lib/agent/setup-fields";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true, name: true, businessType: true, settings: true });
  const cfg = biz ? await prisma.agentConfig.findUnique({ where: { businessId: biz.id }, select: { agentName: true, setupConfig: true } }) : null;
  let setup: SetupConfig = {};
  if (cfg?.setupConfig) { try { setup = JSON.parse(cfg.setupConfig) as SetupConfig; } catch { setup = {}; } }

  // The compact template (stage 0) as this business would get it — the words of
  // its type and its setup answers in their sections. Date, customer memory,
  // FAQs and catalog are injected at runtime and not shown here.
  const vocab = vocabOf(biz);
  const prompt = compactAgentBody({
    agentName: cfg?.agentName ?? "הסוכן", businessName: biz?.name ?? vocab.placeDef, vocab,
    defaultService: typeof setup.defaultService === "string" ? setup.defaultService : null,
    addressStyle: typeof setup.address === "string" ? setup.address : null,
    setup,
  });

  return NextResponse.json({ prompt });
}
