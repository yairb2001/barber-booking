import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { pairingCodeForNumber } from "@/lib/messaging/evolution";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

/**
 * POST /api/admin/whatsapp/pairing-code — "קישור באמצעות מספר הטלפון" for a business on
 * our WhatsApp server, when WhatsApp refuses QR linking ("כרגע אי אפשר לקשר מכשירים חדשים").
 * Recreates the instance bound to the business's number and returns the 8-character code.
 */
export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true, phone: true, whatsappNumber: true, messagingProvider: true, evolutionInstance: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  if (biz.messagingProvider !== "evolution" || !biz.evolutionInstance) return NextResponse.json({ error: "העסק לא מחובר לשרת של Chator" }, { status: 400 });
  const raw = biz.whatsappNumber || biz.phone;
  if (!raw) return NextResponse.json({ error: "אין מספר וואטסאפ לעסק — הגדר אותו בפרטי העסק" }, { status: 400 });
  const number = normalizeIsraeliPhone(raw);
  const r = await pairingCodeForNumber(biz.evolutionInstance, number);
  if (!r.ok) return NextResponse.json({ error: r.error || "failed" }, { status: 502 });
  return NextResponse.json({ ok: true, code: r.code, number });
}
