/**
 * WhatsApp health watchdog.
 * Every 30 minutes, checks each business's GreenAPI instance state and records
 * it on the Business row (waLiveState / waCheckedAt / waDownSince). The admin
 * UI reads this to show a red "WhatsApp disconnected" banner to whoever logs in.
 *
 * Self-heal: if the instance returns an error/unknown state (looks stuck) we
 * fire one reboot — that recovers transient states. A genuine logout
 * ("notAuthorized") needs a QR rescan from the phone and cannot be automated.
 *
 * Secure with CRON_SECRET: GET /api/cron/whatsapp-health?secret=<CRON_SECRET>
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GreenApiProvider } from "@/lib/messaging/green-api";
import { EvolutionProvider, evolutionConfigured, evolutionServerOk, applyEvolutionWebhook } from "@/lib/messaging/evolution";
import { providerForBusiness } from "@/lib/messaging";
import { notifyPlatformOwner } from "@/lib/super-admin";
import { alertWhatsAppDown, alertWhatsAppRecovered } from "@/lib/wa-alerts";

export const dynamic = "force-dynamic";

// States that mean "the bot cannot receive/send" → show the banner.
const DOWN_STATES = new Set(["notAuthorized", "blocked", "yellowCard"]);
// Transient states that usually recover on their own → no banner, no reboot.
const TRANSIENT_STATES = new Set(["starting", "sleepMode"]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret =
    searchParams.get("secret") || req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || ""; // Vercel Cron sends Bearer
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();

  const businesses = await prisma.business.findMany({
    where: {
      OR: [
        { messagingProvider: "green_api", greenApiInstanceId: { not: null }, greenApiToken: { not: null } },
        { messagingProvider: "evolution", evolutionInstance: { not: null } },
      ],
    },
    select: {
      id: true,
      whatsappNumber: true,
      messagingProvider: true,
      greenApiInstanceId: true,
      greenApiToken: true, evolutionInstance: true,
      waDownSince: true,
    },
  });

  let checked = 0, down = 0, recovered = 0, rebooted = 0;

  // Our own WhatsApp server: one alert to the platform owner per hour while it is unreachable.
  let serverOk = true;
  if (evolutionConfigured() && businesses.some(b => b.messagingProvider === "evolution")) {
    const h = await evolutionServerOk();
    serverOk = h.ok;
    if (!h.ok) {
      const recent = await prisma.messageLog.findFirst({ where: { kind: "manual", body: { startsWith: "🔴 שרת הוואטסאפ" }, createdAt: { gte: new Date(now.getTime() - 3600_000) } }, select: { id: true } });
      if (!recent) notifyPlatformOwner(`🔴 שרת הוואטסאפ שלנו לא עונה: ${h.error ?? "unknown"}. ssh manceo → cd /opt/chator-wa && docker compose ps`).catch(() => {});
    }
  }

  for (const biz of businesses) {
    checked++;
    if (biz.messagingProvider === "evolution" && !serverOk) continue; // don't flip every business to "down" on a server blip
    const provider = providerForBusiness(biz);
    if (!provider || !(provider instanceof GreenApiProvider || provider instanceof EvolutionProvider) || !provider.isConfigured()) continue;

    const res = await provider.getState();
    // If GreenAPI itself failed to answer, record "error" but don't flip the
    // banner state aggressively — could be a brief network hiccup on our side.
    const state = res.ok ? (res.state ?? "error") : "error";

    const isDown = DOWN_STATES.has(state);
    const isHealthy = state === "authorized";
    // Our server: keep the incoming-messages webhook in place (idempotent; survives reinstalls).
    if (isHealthy && biz.messagingProvider === "evolution" && biz.evolutionInstance) await applyEvolutionWebhook(biz.evolutionInstance).catch(() => null);

    // Self-heal: an "error" or otherwise stuck (non-healthy, non-down,
    // non-transient) state → try a single reboot to nudge it back.
    if (!isHealthy && !isDown && !TRANSIENT_STATES.has(state)) {
      const rb = await provider.reboot();
      if (rb.ok) rebooted++;
    }

    // Track downSince: set on first transition to a down state, clear on recovery.
    let waDownSince = biz.waDownSince;
    if (isDown && !waDownSince) { waDownSince = now; down++; alertWhatsAppDown(biz.id).catch(() => {}); }
    else if (isHealthy && waDownSince) { alertWhatsAppRecovered(biz.id, waDownSince).catch(() => {}); waDownSince = null; recovered++; }

    await prisma.business.update({
      where: { id: biz.id },
      data: { waLiveState: state, waCheckedAt: now, waDownSince, ...(isHealthy && biz.messagingProvider === "evolution" ? { whatsappStatus: "connected" } : {}) },
    });
  }

  return NextResponse.json({ ok: true, checked, down, recovered, rebooted });
}
