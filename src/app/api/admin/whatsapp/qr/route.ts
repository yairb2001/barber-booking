import { NextRequest, NextResponse } from "next/server";
import { getRequestSession, getSessionBusiness } from "@/lib/session";
import { providerForBusiness } from "@/lib/messaging";
import { GreenApiProvider } from "@/lib/messaging/green-api";
import { EvolutionProvider } from "@/lib/messaging/evolution";
import { prisma } from "@/lib/prisma";

// GET /api/admin/whatsapp/qr
// Any authenticated admin (owner OR barber). Returns the GreenAPI instance
// state and, when the number is disconnected, a fresh linking QR so whoever is
// around — owner or any barber — can re-scan from inside the app instead of
// logging into the GreenAPI console. Reconnecting WhatsApp isn't a sensitive
// owner-only setting; it just restores the shared business line, so every
// staff member who sees the blinking outage banner can fix it.
//   { state, connected, type?, qr?, message? }
// The QR rotates ~every 20s — the client polls this endpoint.
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await getSessionBusiness(req, {
    id: true,
    whatsappNumber: true,
    messagingProvider: true,
    greenApiInstanceId: true,
    greenApiToken: true, evolutionInstance: true,
  });
  if (!business) return NextResponse.json({ error: "business not found" }, { status: 404 });

  const wanted = new URL(req.url).searchParams.get("provider");
  const provider = wanted === "evolution" && business.evolutionInstance
    ? providerForBusiness({ ...business, messagingProvider: "evolution" })
    : providerForBusiness(business);
  if (!provider || !(provider instanceof GreenApiProvider || provider instanceof EvolutionProvider) || !provider.isConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const stateRes = await provider.getState();
  if (!stateRes.ok) {
    return NextResponse.json({ error: stateRes.error || "state_failed" }, { status: 502 });
  }

  // Already linked — no QR needed.
  if (stateRes.state === "authorized") {
    // Our own server sends no "connected" event — the scan screen polling this route is what records it.
    if (provider instanceof EvolutionProvider) {
      await prisma.business.update({ where: { id: business.id }, data: { waLiveState: "authorized", waCheckedAt: new Date(), waDownSince: null, whatsappStatus: "connected" } }).catch(() => null);
    }
    return NextResponse.json({ state: stateRes.state, connected: true });
  }

  // Our own server: every QR request opens a new linking session and kills the one
  // being scanned. While the client still holds a fresh QR (or a pairing code is
  // pending) it sends ?hold=1 and we only report the state.
  const ours = provider instanceof EvolutionProvider;
  if (ours && new URL(req.url).searchParams.get("hold") === "1") {
    return NextResponse.json({ state: stateRes.state, connected: false, keep: true, pollMs: 4000 });
  }

  // Not authorized — fetch a fresh QR to display.
  const qrRes = await provider.getQr();
  if (!qrRes.ok) {
    return NextResponse.json(
      { state: stateRes.state, connected: false, error: qrRes.error || "qr_failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    state: stateRes.state,
    connected: qrRes.type === "alreadyLogged",
    type: qrRes.type,
    qr: qrRes.qr,
    message: qrRes.message,
    ...(ours ? { pollMs: 4000 } : {}),
  });
}
