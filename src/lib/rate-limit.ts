/**
 * Per-IP rate limit for public, message-sending endpoints (OTP send, booking,
 * leads). In-memory sliding window — on Vercel that means per warm instance,
 * which is exactly the shape of a scripted burst (one instance stays hot).
 * A per-phone limit backed by the DB still applies on top for OTP.
 *
 *   const limited = rateLimit(req, "otp", { max: 5, windowMs: 10 * 60_000 });
 *   if (limited) return limited;   // 429
 */
import { NextRequest, NextResponse } from "next/server";

const hits = new Map<string, number[]>();
let lastSweep = 0;

export function clientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for") || "";
  const first = xf.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || req.ip || "unknown";
}

export function rateLimit(req: NextRequest, bucket: string, opts: { max: number; windowMs: number }): NextResponse | null {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    hits.forEach((arr, k) => { const keep = arr.filter((t: number) => now - t < opts.windowMs); if (keep.length) hits.set(k, keep); else hits.delete(k); });
  }
  const key = `${bucket}:${clientIp(req)}`;
  const arr = (hits.get(key) ?? []).filter(t => now - t < opts.windowMs);
  if (arr.length >= opts.max) {
    hits.set(key, arr);
    const retry = Math.ceil((opts.windowMs - (now - arr[0])) / 1000);
    return NextResponse.json({ error: "יותר מדי בקשות — נסה שוב בעוד כמה דקות" }, { status: 429, headers: { "Retry-After": String(Math.max(1, retry)) } });
  }
  arr.push(now);
  hits.set(key, arr);
  return null;
}
