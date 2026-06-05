/**
 * APNs push sender — server side.
 *
 * Sends native push notifications to the iOS Capacitor admin app. Uses Apple's
 * token-based (.p8) auth over HTTP/2. ZERO extra npm packages — Node's built-in
 * `http2` does the transport and the already-installed `jose` signs the ES256
 * provider JWT.
 *
 * Device tokens are collected by `/api/admin/native/device` and stored in JSON:
 *   - owner logins (no staffId) → Business.settings.ownerPushTokens[]
 *   - barber logins             → Staff.settings.pushTokens[]
 *
 * Required env (set in Vercel after you create the Apple push key):
 *   APNS_KEY_ID      — 10-char key ID of the .p8 key
 *   APNS_TEAM_ID     — 10-char Apple Developer Team ID
 *   APNS_BUNDLE_ID   — app bundle id (e.g. com.dominant.admin) → APNs topic
 *   APNS_KEY_P8      — the .p8 private key contents (newlines may be "\n")
 *   APNS_PRODUCTION  — "true" for the App Store / TestFlight build, else sandbox
 *
 * When any of these are missing the whole module no-ops silently, so the app
 * keeps working today (before the Apple Developer account exists) and starts
 * delivering pushes the moment the env is filled in — no code change needed.
 */

import http2 from "node:http2";
import { importPKCS8, SignJWT } from "jose";
import { prisma } from "@/lib/prisma";

export interface PushPayload {
  title: string;
  body: string;
  /** Arbitrary data delivered to the app (deep-link target, ids, etc.) */
  data?: Record<string, string>;
  /** iOS app icon badge count. */
  badge?: number;
  /** Notification sound. Defaults to the system default. */
  sound?: string;
}

interface StoredToken {
  token: string;
  platform?: string;
  registeredAt?: string;
}

function apnsEnv() {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  const p8 = process.env.APNS_KEY_P8;
  if (!keyId || !teamId || !bundleId || !p8) return null;
  const production = process.env.APNS_PRODUCTION === "true";
  return {
    keyId,
    teamId,
    bundleId,
    // Vercel env vars store newlines as literal "\n" — restore them.
    p8: p8.replace(/\\n/g, "\n"),
    host: production ? "api.push.apple.com" : "api.sandbox.push.apple.com",
  };
}

/** Apple requires the provider JWT to be reused 20-60 min; we cache for 50. */
let cachedJwt: { token: string; expiresAt: number } | null = null;

async function getProviderToken(env: NonNullable<ReturnType<typeof apnsEnv>>): Promise<string> {
  const now = Date.now();
  if (cachedJwt && cachedJwt.expiresAt > now) return cachedJwt.token;

  const key = await importPKCS8(env.p8, "ES256");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.keyId })
    .setIssuer(env.teamId)
    .setIssuedAt(Math.floor(now / 1000))
    .sign(key);

  cachedJwt = { token, expiresAt: now + 50 * 60 * 1000 };
  return token;
}

/**
 * Low-level: push to a list of raw device tokens.
 * Returns the tokens that APNs reported as permanently invalid (410 / BadDeviceToken)
 * so the caller can prune them from storage.
 */
export async function sendApns(tokens: string[], payload: PushPayload): Promise<{ sent: number; invalid: string[] }> {
  const env = apnsEnv();
  if (!env || tokens.length === 0) return { sent: 0, invalid: [] };

  let jwt: string;
  try {
    jwt = await getProviderToken(env);
  } catch (err) {
    console.error("[push] failed to sign APNs JWT:", err);
    return { sent: 0, invalid: [] };
  }

  const client = http2.connect(`https://${env.host}`);
  const invalid: string[] = [];
  let sent = 0;

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: payload.sound ?? "default",
      ...(payload.badge != null ? { badge: payload.badge } : {}),
    },
    ...(payload.data ?? {}),
  });

  try {
    await Promise.all(
      tokens.map(
        (deviceToken) =>
          new Promise<void>((resolve) => {
            const reqStream = client.request({
              ":method": "POST",
              ":path": `/3/device/${deviceToken}`,
              authorization: `bearer ${jwt}`,
              "apns-topic": env.bundleId,
              "apns-push-type": "alert",
              "apns-priority": "10",
              "content-type": "application/json",
            });

            let status = 0;
            let resBody = "";
            reqStream.on("response", (headers) => {
              status = Number(headers[":status"]) || 0;
            });
            reqStream.setEncoding("utf8");
            reqStream.on("data", (chunk) => { resBody += chunk; });
            reqStream.on("end", () => {
              if (status === 200) {
                sent++;
              } else if (status === 410 || resBody.includes("BadDeviceToken") || resBody.includes("Unregistered")) {
                invalid.push(deviceToken);
              } else {
                console.error(`[push] APNs ${status} for token …${deviceToken.slice(-6)}: ${resBody}`);
              }
              resolve();
            });
            reqStream.on("error", (err) => {
              console.error("[push] APNs stream error:", err);
              resolve();
            });
            reqStream.end(body);
          })
      )
    );
  } finally {
    client.close();
  }

  return { sent, invalid };
}

function parseTokens(settings: string | null, field: "ownerPushTokens" | "pushTokens"): StoredToken[] {
  if (!settings) return [];
  try {
    const obj = JSON.parse(settings);
    const arr = obj?.[field];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Remove tokens APNs rejected as permanently invalid from a settings JSON blob. */
function pruneTokens(settings: string | null, field: "ownerPushTokens" | "pushTokens", invalid: string[]): string {
  let obj: Record<string, unknown> = {};
  try { obj = settings ? JSON.parse(settings) : {}; } catch { obj = {}; }
  const arr: StoredToken[] = Array.isArray(obj[field]) ? (obj[field] as StoredToken[]) : [];
  obj[field] = arr.filter((t) => !invalid.includes(t.token));
  return JSON.stringify(obj);
}

/**
 * Notify a specific staff member (barber) on their device(s).
 * Safe to call fire-and-forget; never throws.
 */
export async function pushToStaff(staffId: string, payload: PushPayload): Promise<void> {
  if (!apnsEnv()) return;
  try {
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, settings: true } });
    if (!staff) return;
    const tokens = parseTokens(staff.settings, "pushTokens").map((t) => t.token).filter(Boolean);
    if (tokens.length === 0) return;
    const { invalid } = await sendApns(tokens, payload);
    if (invalid.length) {
      await prisma.staff.update({
        where: { id: staff.id },
        data: { settings: pruneTokens(staff.settings, "pushTokens", invalid) },
      });
    }
  } catch (err) {
    console.error("[push] pushToStaff failed:", err);
  }
}

/**
 * Notify the owner(s) of a business on their device(s).
 * Safe to call fire-and-forget; never throws.
 */
export async function pushToOwner(businessId: string, payload: PushPayload): Promise<void> {
  if (!apnsEnv()) return;
  try {
    const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, settings: true } });
    if (!biz) return;
    const tokens = parseTokens(biz.settings, "ownerPushTokens").map((t) => t.token).filter(Boolean);
    if (tokens.length === 0) return;
    const { invalid } = await sendApns(tokens, payload);
    if (invalid.length) {
      await prisma.business.update({
        where: { id: biz.id },
        data: { settings: pruneTokens(biz.settings, "ownerPushTokens", invalid) },
      });
    }
  } catch (err) {
    console.error("[push] pushToOwner failed:", err);
  }
}

/** True when APNs is fully configured (used to gate UI / health checks). */
export function isPushConfigured(): boolean {
  return apnsEnv() !== null;
}
