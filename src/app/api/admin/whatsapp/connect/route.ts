import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { providerForBusiness } from "@/lib/messaging";
import { EvolutionProvider, ensureEvolutionInstance, evolutionConfigured } from "@/lib/messaging/evolution";
import { GreenApiProvider } from "@/lib/messaging/green-api";

/**
 * POST /api/admin/whatsapp/connect — the owner connects the business's WhatsApp
 * by himself (Yair, 6.10.2026: "סריקה קלילה וחיבור מהיר, לא דרך גרין").
 *
 *   { action: "start" }      open the business's device on our own WhatsApp server
 *                            (idempotent) and switch the business to it; the QR /
 *                            pairing code then come from /api/admin/whatsapp/qr and
 *                            /pairing-code. Replaces the old "request → Chator
 *                            provisions a Green instance within an hour" step.
 *   { action: "logout" }     unlink the phone (a new scan relinks)
 *   { action: "reconnect" }  nudge the server's connection for this device
 *
 * A business that is live on Green (DOMINANT) is left alone: switching a live
 * number is a super-admin move (/api/admin/super/businesses/[id]), not a click here.
 */
export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true, slug: true, whatsappNumber: true, whatsappStatus: true, messagingProvider: true, greenApiInstanceId: true, greenApiToken: true, evolutionInstance: true, suspendedAt: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "start";

  if (action === "start") {
    if (biz.suspendedAt) return NextResponse.json({ ok: false, error: "העסק מושהה" }, { status: 403 });
    if (!evolutionConfigured()) return NextResponse.json({ ok: false, error: "שרת הוואטסאפ עוד לא מוגדר. כתוב לנו ונחבר ידנית." }, { status: 503 });
    const liveOnGreen = biz.messagingProvider === "green_api" && !!biz.greenApiInstanceId && !!biz.greenApiToken;
    if (liveOnGreen) return NextResponse.json({ ok: false, error: "המספר של העסק מחובר דרך ספק אחר. להעברה לשרת של Chator כתוב לנו." }, { status: 409 });

    const name = biz.evolutionInstance || biz.slug;
    const made = await ensureEvolutionInstance(name);
    if (!made.ok) return NextResponse.json({ ok: false, error: made.error === "wa_server_not_configured" ? "שרת הוואטסאפ לא זמין כרגע" : "השרת לא ענה, נסה שוב בעוד רגע" }, { status: 502 });
    await prisma.business.update({
      where: { id: biz.id },
      data: { evolutionInstance: name, messagingProvider: "evolution", ...(biz.whatsappStatus === "connected" ? {} : { whatsappStatus: "requested" }) },
    });
    const state = await new EvolutionProvider({ whatsappNumber: biz.whatsappNumber, evolutionInstance: name }).getState();
    return NextResponse.json({ ok: true, instance: name, connected: state.ok && state.state === "authorized" });
  }

  const provider = providerForBusiness(biz);
  if (!provider || !(provider instanceof GreenApiProvider || provider instanceof EvolutionProvider) || !provider.isConfigured()) {
    return NextResponse.json({ ok: false, error: "המספר עוד לא חובר" }, { status: 400 });
  }
  if (action === "logout") {
    const r = await provider.logout();
    if (r.ok) await prisma.business.update({ where: { id: biz.id }, data: { waLiveState: "notAuthorized", waCheckedAt: new Date(), whatsappStatus: "requested" } });
    return NextResponse.json({ ok: r.ok, error: r.error });
  }
  if (action === "reconnect") {
    const r = await provider.reboot();
    return NextResponse.json({ ok: r.ok, error: r.error });
  }
  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
