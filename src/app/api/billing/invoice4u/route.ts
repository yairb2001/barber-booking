/**
 * Invoice4U posts here after a payment / standing-order charge
 * (CallBackUrl + StandingOrderCallBackUrl, signed by our own HMAC in the URL).
 * Every payload is kept (crm_billing_events); a success marks the business
 * paid and records the invoice with its PDF; a failure raises a CRM push.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCallback, readCallback, getDocument } from "@/lib/billing/invoice4u";
import { recordCrmNotification } from "@/lib/crm/notify";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const b = req.nextUrl.searchParams.get("b") ?? "";
  const t = req.nextUrl.searchParams.get("t") ?? "";
  if (!b || !verifyCallback(b, t)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  const raw = await req.text().catch(() => "");
  let payload: Record<string, unknown> = Object.fromEntries(req.nextUrl.searchParams.entries());
  try { payload = { ...payload, ...(raw.trim().startsWith("{") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw).entries())) }; } catch { payload = { ...payload, raw }; }
  delete payload.t;
  const r = readCallback(payload);
  const ev = await prisma.crmBillingEvent.create({ data: { provider: "invoice4u", businessId: b, kind: "callback", payload: JSON.stringify(payload).slice(0, 20000), ok: r.ok } });
  const biz = await prisma.business.findUnique({ where: { id: b }, select: { id: true, name: true, paidAt: true } });
  if (!biz) return NextResponse.json({ ok: true });

  if (r.ok) {
    const doc = r.docNumber ? await getDocument(r.docNumber).catch(() => null) : null;
    await prisma.crmInvoice.create({ data: {
      businessId: b, number: doc?.number ?? r.docNumber, issuedAt: doc?.issuedAt ? new Date(doc.issuedAt) : new Date(),
      amountIls: doc?.total ?? r.amount ?? 0, status: "paid", pdfUrl: doc?.pdfUrl ?? null, provider: "invoice4u", providerId: r.docNumber,
    } });
    await prisma.business.update({ where: { id: b }, data: { ...(biz.paidAt ? {} : { paidAt: new Date() }), suspendedAt: null } });
    await recordCrmNotification(`תשלום התקבל: ${biz.name}${r.amount ? ` · ${r.amount} ₪` : ""}`, { kind: "customer", businessId: b, push: false });
  } else if (r.ok === false) {
    await prisma.crmInvoice.create({ data: { businessId: b, issuedAt: new Date(), amountIls: r.amount ?? 0, status: "failed", provider: "invoice4u" } });
    await recordCrmNotification(`💳 חיוב נכשל: ${biz.name}${r.error ? `\n${r.error}` : ""}`, { kind: "customer", businessId: b, push: true });
  }
  await prisma.crmBillingEvent.update({ where: { id: ev.id }, data: { handled: r.ok !== null } });
  return NextResponse.json({ ok: true });
}

export const POST = handle;
export const GET = handle;
