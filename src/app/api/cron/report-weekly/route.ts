import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { buildWeeklyReportManager, buildWeeklyReportStaff } from "@/lib/messaging/reports";
import { resolveReportsConfig } from "@/lib/messaging/reports-config";

/** Normalized dial key so "0509300173" / "972509300173" / "‭0509…‬" all compare equal. */
const normKey = (ph: string | null | undefined) => (ph || "").replace(/\D/g, "").replace(/^0/, "972");

/**
 * Cron endpoint — runs Sunday morning (06:00 UTC = 09:00 IST summer / 08:00 winter).
 *
 * For each business:
 *   1. Business phone → shop-wide summary.
 *   2. Owner's personal phone (Business.settings.ownerLoginPhone) → shop-wide
 *      summary + the owner's OWN barber stats, combined into one message. The
 *      owner's login phone can differ from Business.phone, and if the owner is
 *      also a barber they'd otherwise only get their personal report — now they
 *      get both, where they actually read.
 *   3. Every other barber (phone != null) → their personal summary.
 *
 * Authorization: Vercel Cron adds `Authorization: Bearer <CRON_SECRET>` header.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const businesses = await prisma.business.findMany({
    select: {
      id: true, name: true, phone: true, settings: true,
      staff: {
        where: { phone: { not: null }, isAvailable: true },
        select: { id: true, name: true, phone: true },
      },
    },
  });

  let sentManager = 0;
  let sentStaff = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const biz of businesses) {
    const cfg = resolveReportsConfig(biz.settings).weekly;
    if (!cfg.owner && !cfg.staff) { skipped++; continue; }

    // Owner's personal phone (how they log in) — may differ from Business.phone.
    let ownerPhone: string | null = null;
    try {
      const o = (JSON.parse(biz.settings || "{}") as { ownerLoginPhone?: unknown }).ownerLoginPhone;
      if (typeof o === "string" && o.trim()) ownerPhone = o.trim();
    } catch { /* ignore malformed settings */ }
    const ownerKey = normKey(ownerPhone) || normKey(biz.phone);
    // The owner's own barber profile (to attach their personal stats).
    const ownerStaff = ownerKey ? biz.staff.find(s => normKey(s.phone) === ownerKey) : undefined;

    // Shop-wide report — built once, reused for the business line + the owner.
    let shop: string | null = null;
    if (cfg.owner) {
      try {
        shop = await buildWeeklyReportManager(biz.id);
      } catch (e: unknown) {
        errors.push(`${biz.name} (shop): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 1) Business phone → shop report.
    if (biz.phone && shop) {
      const result = await sendMessage({ businessId: biz.id, customerPhone: biz.phone, kind: "report_weekly", body: shop });
      if (result.ok) sentManager++;
      else errors.push(`${biz.name} (manager): ${result.error}`);
    } else if (!biz.phone) {
      skipped++;
    }

    // 2) Owner's personal phone. The owner is usually also a barber, so what
    //    they get depends on both switches:
    //      אליי on  + לצוות on  → shop + their own stats, in one message
    //      אליי on  + לצוות off → shop only
    //      אליי off + לצוות on  → their own stats only
    if (ownerPhone && normKey(ownerPhone) !== normKey(biz.phone)) {
      try {
        let body: string | null = null;
        if (cfg.owner && shop) {
          body = shop;
          if (cfg.staff && ownerStaff) {
            const personal = await buildWeeklyReportStaff(biz.id, ownerStaff.id);
            body = `${shop}\n\n━━━━━━━━━━━━━━━\n\n${personal}`;
          }
        } else if (cfg.staff && ownerStaff) {
          body = await buildWeeklyReportStaff(biz.id, ownerStaff.id);
        }
        if (body) {
          const result = await sendMessage({
            businessId: biz.id,
            customerPhone: ownerStaff?.phone || ownerPhone,
            kind: "report_weekly",
            body,
          });
          if (result.ok) sentManager++;
          else errors.push(`${biz.name} (owner): ${result.error}`);
        }
      } catch (e: unknown) {
        errors.push(`${biz.name} (owner): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 3) Every other barber → personal summary. Skip the owner (handled above)
    //    and anyone on the business phone (already covered).
    if (cfg.staff) {
      for (const st of biz.staff) {
        if (!st.phone) { skipped++; continue; }
        if (biz.phone && normKey(st.phone) === normKey(biz.phone)) { skipped++; continue; }
        if (ownerStaff && st.id === ownerStaff.id) { skipped++; continue; }
        try {
          const body = await buildWeeklyReportStaff(biz.id, st.id);
          const result = await sendMessage({ businessId: biz.id, customerPhone: st.phone, kind: "report_weekly", body });
          if (result.ok) sentStaff++;
          else errors.push(`${biz.name} / ${st.name}: ${result.error}`);
        } catch (e: unknown) {
          errors.push(`${biz.name} / ${st.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    businesses: businesses.length,
    sentManager,
    sentStaff,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
