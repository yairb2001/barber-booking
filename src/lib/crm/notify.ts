/**
 * The CRM's notifications feed (10.10.2026: "התראות בנפרד, משימות בנפרד").
 * Every platform alert that goes to Yair on WhatsApp (notifyPlatformOwner) or
 * to a rep (alertRep) is also written here, so the CRM home lists them with
 * read/unread and a link to the lead or customer they are about.
 */
import { prisma } from "@/lib/prisma";

export type NotifyKind = "lead" | "call" | "customer" | "whatsapp" | "system";
export type NotifyMeta = { kind?: NotifyKind; href?: string | null; leadId?: string | null; businessId?: string | null; repId?: string | null };

/** First line = title; the rest (minus "CRM: /admin/crm" pointers) = body. Never throws. */
export async function recordCrmNotification(text: string, meta: NotifyMeta = {}): Promise<void> {
  try {
    const lines = text.split("\n").map(l => l.trim()).filter(l => l && !/^(ב-)?CRM:/.test(l));
    const title = (lines[0] ?? "").slice(0, 200);
    if (!title) return;
    const body = lines.slice(1).join(" · ").slice(0, 600) || null;
    const href = meta.href ?? (meta.leadId ? `/admin/crm/leads/${meta.leadId}` : meta.businessId ? `/admin/crm/customers/${meta.businessId}` : null);
    await prisma.crmNotification.create({ data: { kind: meta.kind ?? "system", title, body, href, leadId: meta.leadId ?? null, businessId: meta.businessId ?? null, repId: meta.repId ?? null } });
  } catch (e) {
    console.error("[crm-notify]", e);
  }
}
