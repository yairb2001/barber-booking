import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { sendMessage, providerForBusiness } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/whatsapp/test-self — right after the number is linked (the
 * wizard's WhatsApp step): send the owner one message FROM his own business
 * number, so he sees the connection work, and mark the business connected.
 */
export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true, name: true, phone: true, settings: true, messagingProvider: true, whatsappNumber: true, greenApiInstanceId: true, greenApiToken: true, evolutionInstance: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  if (!providerForBusiness(biz)?.isConfigured()) return NextResponse.json({ error: "המספר עדיין לא חובר" }, { status: 400 });
  let owner: string | null = null;
  try { const s = biz.settings ? JSON.parse(biz.settings) as { ownerLoginPhone?: string } : {}; owner = s.ownerLoginPhone || null; } catch { /* ignore */ }
  const to = owner || biz.phone;
  if (!to) return NextResponse.json({ error: "אין טלפון של בעל העסק" }, { status: 400 });
  try {
    await sendMessage({ businessId: biz.id, customerPhone: normalizeIsraeliPhone(to), kind: "manual", body: `✅ הוואטסאפ של ${biz.name} מחובר ל‑Chator. ההודעה הזאת נשלחה מהמספר של העסק שלך — מכאן הסוכן יענה ללקוחות.` });
    await prisma.business.update({ where: { id: biz.id }, data: { whatsappStatus: "connected" } });
    return NextResponse.json({ ok: true, to });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 500 });
  }
}
