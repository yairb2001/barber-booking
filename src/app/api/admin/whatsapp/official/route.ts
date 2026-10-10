import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { recordCrmNotification } from "@/lib/crm/notify";

export const dynamic = "force-dynamic";

/**
 * Official WhatsApp at the connection step (10.10.2026, Yair: "שיהיה אפשר
 * לבחור רשמי בהרשמה, ברגע שהוא נותן את הברקוד"). Until Meta approves Chator
 * as a tech provider (META_CONFIG_ID set = the connect window exists), the
 * choice is recorded (settings.waWanted) and Yair sees it in the CRM; the
 * owner can start on the regular connection meanwhile and move later.
 */
const parse = (raw: string | null | undefined): Record<string, unknown> => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };
const available = () => !!process.env.META_CONFIG_ID;

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { settings: true, messagingProvider: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  return NextResponse.json({ available: available(), wanted: parse(biz.settings).waWanted === "official", official: biz.messagingProvider === "meta_cloud" });
}

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true, name: true, settings: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  const s = parse(biz.settings);
  if (s.waWanted !== "official") {
    s.waWanted = "official";
    s.waWantedAt = new Date().toISOString();
    await prisma.business.update({ where: { id: biz.id }, data: { settings: JSON.stringify(s) } });
    await recordCrmNotification(`${biz.name} בחר וואטסאפ רשמי בחיבור`, { kind: "customer", businessId: biz.id, push: false });
  }
  return NextResponse.json({ ok: true, available: available() });
}
