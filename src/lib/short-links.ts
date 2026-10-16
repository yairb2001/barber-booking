// Long links to our own app in a WhatsApp message become /s/<code> (owner,
// 16.10.2026: the add-to-calendar link filled half the confirmation). Applied
// once, at delivery (deliverMessageLog), so every message kind is covered —
// confirmations, waitlist turns, closures — without touching each template.
import { prisma } from "@/lib/prisma";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const MAX_LEN = 60; // shorter links stay as they are (/t/<token> is ~50)

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app").replace(/\/$/, "");
}

function newCode(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join("");
}

/** Our own long links → short ones. Anything else (other sites, short links) untouched. */
export async function shortenOwnLinks(body: string, businessId: string | null): Promise<string> {
  const base = appBase();
  const host = new URL(base).host;
  const urls = Array.from(new Set(body.match(/https?:\/\/[^\s<>"']+/g) ?? []))
    .filter(u => u.length > MAX_LEN && (() => { try { return new URL(u).host === host; } catch { return false; } })());
  let out = body;
  for (const url of urls) {
    const code = newCode();
    await prisma.shortLink.create({ data: { code, url, businessId } });
    out = out.split(url).join(`${base}/s/${code}`);
  }
  return out;
}
