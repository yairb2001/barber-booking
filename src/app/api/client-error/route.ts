import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

// Crash reports from customers' browsers (owner, 10.10.2026: a rare white
// "Application error" screen on the booking confirm step, with no way to see
// what broke). Stores only what's needed to debug: the PATH WITHOUT the query
// string (the confirm URL can carry phone / name), message, a stack prefix,
// browser and build. No auth — it only ever inserts one short row.
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "client-error", { max: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const b = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ ok: false }, { status: 400 });
  const path = clip(b.path, 300)?.split("?")[0]?.split("#")[0] ?? null;
  await prisma.$executeRaw`
    INSERT INTO client_errors (path, message, stack, digest, kind, build, ua, reloaded)
    VALUES (${path}, ${clip(b.message, 500)}, ${clip(b.stack, 1500)}, ${clip(b.digest, 100)}, ${clip(b.kind, 40)},
            ${clip(b.build, 20)}, ${clip(req.headers.get("user-agent"), 300)}, ${b.reloaded === true})`
    .catch(err => console.error("[client-error] insert failed", err));
  return NextResponse.json({ ok: true });
}
