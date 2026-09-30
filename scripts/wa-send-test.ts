/**
 * Send one WhatsApp text through a business's configured provider (Green or our
 * Evolution server) — to verify a freshly linked number.
 *   npx tsx --env-file=.env scripts/wa-send-test.ts <slug> <phone> ["text"]
 * Needs EVOLUTION_API_URL / EVOLUTION_API_KEY in the environment for Evolution
 * businesses (source ~/.config/chator/wa-server.env).
 */
import { prisma } from "../src/lib/prisma";
import { sendMessage } from "../src/lib/messaging";
import { normalizeIsraeliPhone } from "../src/lib/messaging/phone";
(async () => {
  const [slug, phone, text] = process.argv.slice(2);
  if (!slug || !phone) throw new Error("usage: <slug> <phone> [text]");
  const biz = await prisma.business.findFirst({ where: { slug }, select: { id: true, name: true, messagingProvider: true, evolutionInstance: true, waLiveState: true } });
  if (!biz) throw new Error("business not found");
  console.log(`${biz.name}: provider=${biz.messagingProvider} instance=${biz.evolutionInstance} state=${biz.waLiveState}`);
  const r = await sendMessage({ businessId: biz.id, customerPhone: normalizeIsraeliPhone(phone), kind: "manual", body: text || `בדיקה: ההודעה הזאת נשלחה מ-${biz.name} דרך שרת הוואטסאפ שלנו ✅` });
  console.log("result:", JSON.stringify(r).slice(0, 300));
  const log = await prisma.messageLog.findFirst({ where: { businessId: biz.id, kind: "manual" }, orderBy: { createdAt: "desc" }, select: { status: true, error: true } });
  console.log("log:", JSON.stringify(log));
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
