/**
 * Invoice4U — Yair's invoicing and card clearing provider (chosen 10.10.2026).
 *
 * What we use (all in their public WSDL, JSON POST to ApiService.svc/<Method>):
 *  - ProcessApiRequestV2: a hosted payment page; with IsStandingOrderRequest it
 *    opens a monthly standing order, and IsDocCreate issues an invoice-receipt
 *    and mails it on every charge. CallBackUrl / StandingOrderCallBackUrl post
 *    each result back to us. IsQaMode = a test that charges nothing.
 *  - GetDocumentByNumber: the document, incl. PrintOriginalPDFLink.
 *  - GetClearingLogByParams: reconciliation if a callback is missed.
 *
 * State of the account on 10.10.2026: clearing active (incl. Bit), standing
 * orders and card tokens NOT active (expired 02.2024), API key expires
 * 25.10.2026. Until Yair re-activates them and puts a fresh key in
 * INVOICE4U_API_KEY, isConfigured() is false and the CRM offers manual invoices.
 * The exact callback fields are confirmed on the first QA-mode run; the
 * handler keeps every raw payload so nothing is lost meanwhile.
 */
import crypto from "node:crypto";

const BASE = "https://api.invoice4u.co.il/Services/ApiService.svc";
const key = () => process.env.INVOICE4U_API_KEY || "";
export const isConfigured = () => key().length > 10;

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${BASE}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Invoice4U ${method} HTTP ${r.status}`);
  return ((j as { d?: T }).d ?? j) as T;
}

/** Signed callback URL — Invoice4U cannot sign its posts, so the URL carries our HMAC. */
export function callbackUrl(origin: string, businessId: string): string {
  const t = crypto.createHmac("sha256", process.env.AUTH_SECRET || "x").update(`i4u:${businessId}`).digest("hex").slice(0, 24);
  return `${origin}/api/billing/invoice4u?b=${encodeURIComponent(businessId)}&t=${t}`;
}
export function verifyCallback(businessId: string, t: string): boolean {
  const want = crypto.createHmac("sha256", process.env.AUTH_SECRET || "x").update(`i4u:${businessId}`).digest("hex").slice(0, 24);
  return t.length === want.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want));
}

/** A payment page that opens a monthly standing order; returns its URL. */
export async function createStandingOrderLink(p: { origin: string; businessId: string; fullName: string; email: string; phone: string; amountIls: number; itemName: string; qa?: boolean }): Promise<string> {
  if (!isConfigured()) throw new Error("Invoice4U is not connected yet");
  const cb = callbackUrl(p.origin, p.businessId);
  const res = await call<{ ClearingRedirectUrl?: string; ErrorMessage?: string }>("ProcessApiRequestV2", {
    request: {
      Invoice4UUserApiKey: key(),
      Type: 1,
      Sum: p.amountIls,
      Currency: "ILS",
      PaymentsNum: 1,
      Description: p.itemName,
      FullName: p.fullName,
      Email: p.email,
      Phone: p.phone,
      IsAutoCreateCustomer: true,
      IsDocCreate: true,
      DocHeadline: p.itemName,
      DocItemName: p.itemName,
      DocItemPrice: String(p.amountIls),
      DocItemQuantity: "1",
      IsStandingOrderRequest: true,
      StandingOrderFirstChargeAmount: p.amountIls,
      CallBackUrl: cb,
      StandingOrderCallBackUrl: cb,
      ReturnUrl: `${p.origin}/admin`,
      OrderIdClientUsage: p.businessId,
      Language: "he",
      IsQaMode: !!p.qa,
    },
  });
  if (!res?.ClearingRedirectUrl) throw new Error(res?.ErrorMessage || "no payment page returned");
  return res.ClearingRedirectUrl;
}

/** documentType 3 = חשבונית מס קבלה in Yair's account. */
export async function getDocument(number: string | number, documentType = 3): Promise<{ number: string; total: number; pdfUrl: string | null; issuedAt: string | null } | null> {
  if (!isConfigured()) return null;
  const d = await call<{ DocumentNumber?: number; Total?: number; PrintOriginalPDFLink?: string; IssueDate?: string } | null>("GetDocumentByNumber", { docNumber: Number(number), documentType, token: key() });
  if (!d || !d.DocumentNumber) return null;
  return { number: String(d.DocumentNumber), total: Number(d.Total ?? 0), pdfUrl: d.PrintOriginalPDFLink ?? null, issuedAt: d.IssueDate ?? null };
}

/** Pull the fields we care about out of a callback, whatever its shape. */
export function readCallback(payload: Record<string, unknown>): { ok: boolean | null; docNumber: string | null; amount: number | null; error: string | null } {
  const flat: Record<string, unknown> = {};
  const walk = (o: unknown) => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (v && typeof v === "object") walk(v); else flat[k.toLowerCase()] = v; } };
  walk(payload);
  const pick = (...ks: string[]) => { for (const k of ks) if (flat[k] !== undefined && flat[k] !== "") return flat[k]; return undefined; };
  const okRaw = pick("issuccess", "clearingsuccess", "success", "status");
  const ok = okRaw === undefined ? null : ["true", "1", "ok", "success", "approved"].includes(String(okRaw).toLowerCase());
  const doc = pick("documentnumber", "docnumber", "invoicenumber");
  const amt = pick("sum", "totalamount", "amount", "total");
  const err = pick("errormessage", "clearingerror", "error");
  return { ok, docNumber: doc !== undefined ? String(doc) : null, amount: amt !== undefined && Number.isFinite(Number(amt)) ? Number(amt) : null, error: err !== undefined ? String(err) : null };
}
