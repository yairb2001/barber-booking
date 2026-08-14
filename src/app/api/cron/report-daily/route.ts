import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { buildDailyReport, buildDailyReportStaff } from "@/lib/messaging/reports";
import { resolveReportsConfig } from "@/lib/messaging/reports-config";

/** Normalized dial key so "0509300173" / "972509300173" compare equal. */
const normKey = (ph: string | null | undefined) => (ph || "").replace(/\D/g, "").replace(/^0/, "972");

/**
 * Cron endpoint — runs at 19:00 UTC Sun-Fri (= 22:00 IST in summer / 21:00 IST in winter).
 * Sends a daily summary to the business manager.
 *
 * Recipients: the business phone (Business.phone) AND the owner's personal login
 * phone (Business.settings.ownerLoginPhone). These can be DIFFERENT numbers — the
 * owner reads the login phone, so a report sent only to Business.phone never
 * reaches them. We send to both (deduped by number).
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
    where: { phone: { not: null } },
    select: {
      id: true, name: true, phone: true, settings: true,
      staff: {
        where: { phone: { not: null }, isAvailable: true },
        select: { id: true, name: true, phone: true },
      },
    },
  });

  let sent = 0;
  let sentStaff = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const biz of businesses) {
    const cfg = resolveReportsConfig(biz.settings).daily;
    if (!cfg.owner && !cfg.staff) { skipped++; continue; }

    // ── Shop-wide report → manager ──
    if (cfg.owner) {
      const recipients = managerRecipients(biz.phone, biz.settings);
      if (recipients.length === 0) {
        skipped++;
      } else {
        let body: string | null = null;
        try {
          body = await buildDailyReport(biz.id);
        } catch (e: unknown) {
          errors.push(`${biz.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (body) {
          for (const to of recipients) {
            try {
              const result = await sendMessage({
                businessId: biz.id,
                customerPhone: to,
                kind: "report_daily",
                body,
              });
              if (result.ok) sent++;
              else errors.push(`${biz.name} -> ${to}: ${result.error}`);
            } catch (e: unknown) {
              errors.push(`${biz.name} -> ${to}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
      }
    }

    // ── Personal numbers → each barber ──
    // Skips anyone already reached above on the manager numbers, so the owner
    // (who is often also a barber) never gets two messages.
    if (cfg.staff) {
      const managerKeys = new Set(managerRecipients(biz.phone, biz.settings).map(normKey));
      for (const st of biz.staff) {
        if (!st.phone) { skipped++; continue; }
        if (cfg.owner && managerKeys.has(normKey(st.phone))) { skipped++; continue; }
        try {
          const body = await buildDailyReportStaff(biz.id, st.id);
          const result = await sendMessage({ businessId: biz.id, customerPhone: st.phone, kind: "report_daily", body });
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
    sent,
    sentStaff,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}

/**
 * Recipients for a manager report: the business phone + the owner's personal
 * login phone (Business.settings.ownerLoginPhone), deduped by normalized number.
 */
function managerRecipients(bizPhone: string | null, settings: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (ph: string | null | undefined) => {
    if (!ph) return;
    const key = ph.replace(/\D/g, "").replace(/^0/, "972");
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(ph);
  };
  add(bizPhone);
  try {
    const owner = (JSON.parse(settings || "{}") as { ownerLoginPhone?: unknown }).ownerLoginPhone;
    if (typeof owner === "string") add(owner.trim());
  } catch { /* ignore malformed settings */ }
  return out;
}
