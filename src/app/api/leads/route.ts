import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { notifyPlatformOwner } from "@/lib/super-admin";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { ensureCrmSeed } from "@/lib/crm/core";
import { startAutomation } from "@/lib/crm/automations";

/**
 * PUBLIC lead capture — the /for-business landing page posts here.
 *
 * Lives outside /api/admin so the auth middleware doesn't guard it. Records the
 * prospect and fires a WhatsApp alert to the platform owner so no lead is lost.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "leads", { max: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";

  if (!phone || phone.replace(/\D/g, "").length < 9) {
    return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
  }

  const businessName = typeof body?.businessName === "string" ? body.businessName.trim().slice(0, 120) : "";
  const shopSize = typeof body?.shopSize === "string" ? body.shopSize.trim().slice(0, 40) : "";
  // The same person filling the form twice is one lead (CRM, 9.10.2026).
  const normalized = normalizeIsraeliPhone(phone);
  await ensureCrmSeed().catch(() => {});
  const rep = await prisma.salesRep.findFirst({ where: { active: true }, orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }], select: { id: true } });
  const existing = await prisma.lead.findFirst({ where: { phone: { in: [phone, normalized] } }, orderBy: { createdAt: "desc" }, select: { id: true, stage: true } });
  const lead = existing
    ? await prisma.lead.update({ where: { id: existing.id }, data: { ...(name ? { name } : {}), ...(businessName ? { businessName } : {}), ...(shopSize ? { shopSize } : {}) }, select: { id: true } })
    : await prisma.lead.create({
        data: {
          name: name || null,
          phone: normalized,
          source: "landing",
          status: "new",
          stage: "new",
          repId: rep?.id ?? null,
          businessName: businessName || null,
          shopSize: shopSize || null,
        },
        select: { id: true },
      });
  if (!existing || existing.stage === "new") await startAutomation("lead_new", { leadId: lead.id });

  await notifyPlatformOwner(
    `🔥 ליד חדש מהאתר\nשם: ${name || "—"}\nטלפון: ${phone}\nב-CRM: /admin/crm`,
    { kind: "lead", leadId: lead.id },
  );

  return NextResponse.json({ ok: true, id: lead.id });
}
