/**
 * Platform-level LLM health.
 *
 * The Anthropic API key is a SINGLE platform resource shared by every tenant's
 * agent. When it fails (revoked key / out of credit) EVERY business's agent goes
 * dark — exactly the outage that ran for ~2 days undetected. This module runs a
 * tiny canary call, and on an auth/billing failure alerts ONLY the platform
 * owner (never the individual businesses) and records status for the platform
 * dashboard.
 */
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { SUPER_ADMIN_BUSINESS_ID, notifyPlatformOwner } from "@/lib/super-admin";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const ALERT_GAP_MS = 60 * 60 * 1000; // re-alert at most once per hour while down

export type LlmHealth = {
  ok: boolean;
  lastCheckAt: string | null;
  lastError: string | null;
  lastFailAt: string | null;
  lastAlertAt: string | null;
};

async function readSuperSettings(): Promise<Record<string, unknown>> {
  const b = await prisma.business.findUnique({
    where: { id: SUPER_ADMIN_BUSINESS_ID }, select: { settings: true },
  });
  try { return b?.settings ? JSON.parse(b.settings) : {}; } catch { return {}; }
}

export async function getLlmHealth(): Promise<LlmHealth | null> {
  const s = await readSuperSettings();
  return (s.llmHealth as LlmHealth | undefined) ?? null;
}

async function writeLlmHealth(h: LlmHealth): Promise<void> {
  const s = await readSuperSettings();
  s.llmHealth = h;
  await prisma.business.update({
    where: { id: SUPER_ADMIN_BUSINESS_ID }, data: { settings: JSON.stringify(s) },
  });
}

/**
 * Canary: is the platform's Claude key working right now? Only auth/billing
 * failures count as "platform down" — a transient overload (429/529/5xx) is NOT
 * a credit problem and must not flip the status or fire an alert.
 */
export async function checkAndRecordLlmHealth(now: Date = new Date()): Promise<LlmHealth | null> {
  const prev = await getLlmHealth();
  let error: string | null = null;
  try {
    await anthropic.messages.create({
      model: "claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "ping" }],
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    const platformFailure =
      err.status === 401 ||
      (err.status === 400 && /credit|billing|balance/i.test(err.message || ""));
    if (!platformFailure) return prev; // transient — leave status untouched
    error = `${err.status}: ${(err.message || "").slice(0, 140)}`;
  }

  const ok = error === null;
  const health: LlmHealth = {
    ok,
    lastCheckAt: now.toISOString(),
    lastError: error,
    lastFailAt: ok ? (prev?.lastFailAt ?? null) : now.toISOString(),
    lastAlertAt: prev?.lastAlertAt ?? null,
  };

  if (!ok) {
    const lastAlert = prev?.lastAlertAt ? new Date(prev.lastAlertAt).getTime() : 0;
    if (now.getTime() - lastAlert > ALERT_GAP_MS) {
      health.lastAlertAt = now.toISOString();
      // Platform owner ONLY — the businesses never see this.
      await notifyPlatformOwner(
        `🔴 תקלת פלטפורמה: הסוכן לא מצליח להגיע ל-Claude.\n${error}\n` +
        `כל הסוכנים של כל העסקים מושבתים עד שתטפל. בדוק קרדיט/מפתח ב-console.anthropic.com.`
      );
    }
  }
  await writeLlmHealth(health);
  return health;
}
