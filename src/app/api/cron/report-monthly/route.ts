import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { buildMonthlyReportManager, buildMonthlyReportStaff } from "@/lib/messaging/reports";
import { resolveReportsConfig } from "@/lib/messaging/reports-config";

/** Normalized dial key so "0509300173" / "972509300173" compare equal. */
const normKey = (ph: string | null | undefined) => (ph || "").replace(/\D/g, "").replace(/^0/, "972");

/**
 * Cron endpoint — runs on the 1st of every month, 06:00 UTC (= 09:00 IST summer / 08:00 winter).
 *
 * For each business:
 *   1. Send monthly summary (previous calendar month) to the manager — the
 *      business phone AND the owner's login phone, which can differ.
 *   2. Send personal monthly summary to each Staff with phone != null
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
    const cfg = resolveReportsConfig(biz.settings).monthly;
    if (!cfg.owner && !cfg.staff) { skipped++; continue; }

    // Owner's personal phone (how they log in) — may differ from Business.phone.
    // Daily and weekly have always sent to both; monthly only ever sent to
    // Business.phone, so an owner whose login number differs never got it.
    let ownerPhone: string | null = null;
    try {
      const o = (JSON.parse(biz.settings || "{}") as { ownerLoginPhone?: unknown }).ownerLoginPhone;
      if (typeof o === "string" && o.trim()) ownerPhone = o.trim();
    } catch { /* ignore malformed settings */ }
    const ownerKey = normKey(ownerPhone) || normKey(biz.phone);
    const ownerStaff = ownerKey ? biz.staff.find(s => normKey(s.phone) === ownerKey) : undefined;

    if (cfg.owner) {
      const recipients: string[] = [];
      const seen = new Set<string>();
      for (const ph of [biz.phone, ownerPhone]) {
        const k = normKey(ph);
        if (!ph || !k || seen.has(k)) continue;
        seen.add(k);
        recipients.push(ph);
      }
      if (recipients.length === 0) {
        skipped++;
      } else {
        try {
          const body = await buildMonthlyReportManager(biz.id);
          for (const to of recipients) {
            const result = await sendMessage({
              businessId: biz.id,
              customerPhone: to,
              kind: "report_monthly",
              body,
            });
            if (result.ok) sentManager++;
            else errors.push(`${biz.name} (manager): ${result.error}`);
          }
        } catch (e: unknown) {
          errors.push(`${biz.name} (manager): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    if (!cfg.staff) continue;
    for (const st of biz.staff) {
      if (!st.phone) { skipped++; continue; }
      if (biz.phone && normKey(st.phone) === normKey(biz.phone)) { skipped++; continue; }
      // The owner already got the shop-wide report on this number above.
      if (cfg.owner && ownerStaff && st.id === ownerStaff.id) { skipped++; continue; }
      try {
        const body = await buildMonthlyReportStaff(biz.id, st.id);
        const result = await sendMessage({
          businessId: biz.id,
          customerPhone: st.phone,
          kind: "report_monthly",
          body,
        });
        if (result.ok) sentStaff++;
        else errors.push(`${biz.name} / ${st.name}: ${result.error}`);
      } catch (e: unknown) {
        errors.push(`${biz.name} / ${st.name}: ${e instanceof Error ? e.message : String(e)}`);
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
