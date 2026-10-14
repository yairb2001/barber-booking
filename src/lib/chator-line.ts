/**
 * Chator's own WhatsApp line: today the demo shop's number ("המספרה של דני"),
 * which also carries the sales agent, the support agent for owners and every
 * CRM message to a lead or an owner (14.10.2026, Yair: one line for now, a
 * second one only if it causes trouble). Change the sending business here and
 * every CRM message moves with it.
 *
 * Owners get our messages on the number their own agent answers from, so a
 * shop's agent must never answer this line: two bots would talk to each other
 * (18.9.2026, DOMINANT's agent answered a message from this line as if a
 * customer wrote). The owner reads it and answers himself.
 */
import { prisma } from "@/lib/prisma";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

export const CHATOR_LINE_BUSINESS_ID = DEMO_BUSINESS_ID;

let cache: { at: number; phone: string } | null = null;

async function linePhone(): Promise<string> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.phone;
  const b = await prisma.business.findUnique({ where: { id: CHATOR_LINE_BUSINESS_ID }, select: { phone: true } }).catch(() => null);
  cache = { at: Date.now(), phone: b?.phone ? normalizeIsraeliPhone(b.phone) : "" };
  return cache.phone;
}

/** Is this sender Chator's own line? */
export async function isChatorLine(phone: string): Promise<boolean> {
  const want = normalizeIsraeliPhone(phone);
  return !!want && want === await linePhone();
}
