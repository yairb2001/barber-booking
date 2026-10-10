import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { getPlans, planKeyOf, usageFor, type PackKind } from "@/lib/crm/plans";
import { getCrmSettings } from "@/lib/crm/core";
import { recordCrmNotification } from "@/lib/crm/notify";
import { payLinkFor } from "@/lib/billing/pay-link";

export const dynamic = "force-dynamic";

/**
 * The owner's "המסלול שלי" (10.10.2026). What he pays for and how much of it
 * he used this month, the other plans, add-on packs and his invoices.
 *
 * The agent meter is a percentage only: its cap is our raw cost, and the
 * owner never sees cost (same rule as usage-meter). Changing plan or buying a
 * pack is a REQUEST to Chator (a CRM notification and a task) until card
 * billing is connected; nothing is charged from here.
 */
const PACK_LABEL: Record<PackKind, string> = { messages: "חבילת הודעות", ai: "חבילת סוכן", marketing: "חבילת הודעות שיווק" };
const parse = (raw: string | null | undefined): Record<string, unknown> => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true, slug: true, settings: true, trialEndsAt: true, paidAt: true, monthlyPrice: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  const [plans, usage, cs, packs, invoices] = await Promise.all([
    getPlans(),
    usageFor([biz.id]),
    getCrmSettings(),
    prisma.crmPack.findMany({ where: { businessId: biz.id }, orderBy: { createdAt: "desc" }, take: 12 }),
    prisma.crmInvoice.findMany({ where: { businessId: biz.id }, orderBy: { issuedAt: "desc" }, take: 24 }),
  ]);
  const u = usage.get(biz.id) ?? null;
  const s = parse(biz.settings);
  const requests = (s.planRequests ?? {}) as Record<string, string>;
  return NextResponse.json({
    planKey: planKeyOf(biz.settings),
    plans: plans.filter(p => p.active).map(p => ({ key: p.key, name: p.name, apptsCap: p.apptsCap, messages: p.messages, priceIls: p.priceIls })),
    usage: u && {
      month: u.month,
      appts: u.appts, messages: u.messages, marketing: u.marketing,
      aiPct: u.ai.pct,
    },
    packs: packs.map(p => ({ id: p.id, kind: p.kind, qty: p.kind === "ai" ? null : p.qty, priceIls: p.priceIls, month: p.month })),
    packPrices: { messages: { qty: cs.packMessagesQty, price: cs.packMessagesPrice }, ai: { qty: null, price: cs.packAiPrice }, marketing: { qty: cs.packMarketingQty, price: cs.packMarketingPrice } },
    invoices: invoices.map(i => ({ id: i.id, number: i.number, issuedAt: i.issuedAt, amountIls: i.amountIls, status: i.status, pdfUrl: i.pdfUrl })),
    trialEndsAt: biz.paidAt ? null : biz.trialEndsAt,
    paying: !!biz.paidAt,
    monthlyPrice: biz.monthlyPrice,
    requested: requests,
    payUrl: biz.paidAt ? null : payLinkFor(biz),
  });
}

/** { kind: "plan", planKey } | { kind: "pack", pack: "messages" | "ai" | "marketing" } */
export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true, name: true, settings: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const plans = await getPlans();
  let key: string, text: string;
  if (body.kind === "plan") {
    const plan = plans.find(p => p.key === body.planKey && p.active);
    if (!plan) return NextResponse.json({ error: "מסלול לא קיים" }, { status: 400 });
    if (planKeyOf(biz.settings) === plan.key) return NextResponse.json({ error: "זה כבר המסלול שלך" }, { status: 400 });
    key = `plan:${plan.key}`;
    text = `${biz.name} מבקש לעבור למסלול ${plan.name} (${plan.priceIls} ₪)`;
  } else if (body.kind === "pack" && ["messages", "ai", "marketing"].includes(body.pack)) {
    key = `pack:${body.pack}`;
    text = `${biz.name} מבקש ${PACK_LABEL[body.pack as PackKind]} לחודש הזה`;
  } else {
    return NextResponse.json({ error: "בקשה לא מוכרת" }, { status: 400 });
  }
  // One request per item per day: a second tap does not ping Chator again.
  const s = parse(biz.settings);
  const requests = (s.planRequests ?? {}) as Record<string, string>;
  const last = requests[key] ? new Date(requests[key]).getTime() : 0;
  if (Date.now() - last < 24 * 3600_000) return NextResponse.json({ ok: true, already: true });
  requests[key] = new Date().toISOString();
  s.planRequests = requests;
  await prisma.business.update({ where: { id: biz.id }, data: { settings: JSON.stringify(s) } });
  await recordCrmNotification(text, { kind: "customer", businessId: biz.id, push: true });
  await prisma.crmTask.create({ data: { title: text, businessId: biz.id, dueAt: new Date() } });
  return NextResponse.json({ ok: true });
}
