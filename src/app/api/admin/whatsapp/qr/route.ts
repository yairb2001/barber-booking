import { NextRequest, NextResponse } from "next/server";
import { requireOwner, getSessionBusiness } from "@/lib/session";
import { GreenApiProvider } from "@/lib/messaging/green-api";

// GET /api/admin/whatsapp/qr
// Owner-only. Returns the GreenAPI instance state and, when the number is
// disconnected, a fresh linking QR so the owner can re-scan from inside the
// app instead of logging into the GreenAPI console.
//   { state, connected, type?, qr?, message? }
// The QR rotates ~every 20s — the client polls this endpoint.
export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const business = await getSessionBusiness(req, {
    whatsappNumber: true,
    greenApiInstanceId: true,
    greenApiToken: true,
  });
  if (!business) return NextResponse.json({ error: "business not found" }, { status: 404 });

  const provider = new GreenApiProvider({
    whatsappNumber: business.whatsappNumber,
    greenApiInstanceId: business.greenApiInstanceId,
    greenApiToken: business.greenApiToken,
  });
  if (!provider.isConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const stateRes = await provider.getState();
  if (!stateRes.ok) {
    return NextResponse.json({ error: stateRes.error || "state_failed" }, { status: 502 });
  }

  // Already linked — no QR needed.
  if (stateRes.state === "authorized") {
    return NextResponse.json({ state: stateRes.state, connected: true });
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
  });
}
