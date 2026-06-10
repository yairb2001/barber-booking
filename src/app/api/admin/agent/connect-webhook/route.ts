/**
 * POST /api/admin/agent/connect-webhook
 *
 * One-click GreenAPI wiring: points the business's WhatsApp instance webhook
 * at our handler and enables incoming-message delivery. Removes the manual
 * copy-paste-into-GreenAPI step that blocks non-technical owners.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const biz = await prisma.business.findFirst({
    select: { greenApiInstanceId: true, greenApiToken: true },
  });
  const id = biz?.greenApiInstanceId;
  const token = biz?.greenApiToken;
  if (!id || !token) {
    return NextResponse.json(
      { ok: false, error: "GreenAPI לא מוגדר — הזן Instance ID ו-Token בהגדרות תחילה." },
      { status: 400 }
    );
  }

  const webhookUrl = `${req.nextUrl.origin}/api/webhook/whatsapp`;

  try {
    const res = await fetch(`https://api.green-api.com/waInstance${id}/setSettings/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookUrl,
        incomingWebhook: "yes",
        outgoingWebhook: "no",
        outgoingMessageWebhook: "no",
        outgoingAPIMessageWebhook: "no",
        stateWebhook: "no",
        deviceWebhook: "no",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `GreenAPI HTTP ${res.status}: ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = (await res.json().catch(() => ({}))) as { saveSettings?: boolean };
    return NextResponse.json({ ok: true, webhookUrl, saveSettings: data?.saveSettings ?? null });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Network error" },
      { status: 502 }
    );
  }
}
