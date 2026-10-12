/**
 * Connect (or switch on/off) an Instagram professional account for a business:
 * writes Business.settings.instagram = { igUserId, username, enabled, agent, testers },
 * keeping every other setting as it is. Until the connect page exists (plan step 7),
 * this is how an account gets linked.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/instagram-link.ts <businessId> <igUserId> <username> on|off [agent=off|test|on] [testers=<IGSID>,<IGSID>]
 *   npx tsx --env-file=.env scripts/instagram-link.ts <businessId> show
 *
 *   on|off   DMs reach the inbox (off: the webhook only logs)
 *   agent    who the sales agent answers: nobody, only the testers, everyone (Chator only)
 *
 * Chator (12.10.2026): demo business ad8d79ef-33ea-4230-9c19-2ed01f0f3a96,
 * @chator.il = 17841417369685491, yair_buchbut = 1984906812202758.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [businessId, igUserId, username, mode, ...rest] = process.argv.slice(2);
  if (!businessId) throw new Error("usage: <businessId> <igUserId> <username> on|off [agent=off|test|on] [testers=a,b] | <businessId> show");
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, settings: true } });
  if (!biz) throw new Error(`no business ${businessId}`);
  const settings = (() => { try { return biz.settings ? JSON.parse(biz.settings) : {}; } catch { throw new Error("settings is not JSON, not touching it"); } })();
  if (igUserId === "show") {
    console.log(biz.name, JSON.stringify(settings.instagram ?? null));
    return;
  }
  if (!/^\d{5,25}$/.test(igUserId ?? "") || !username || !["on", "off"].includes(mode ?? "")) {
    throw new Error("usage: <businessId> <igUserId> <username> on|off [agent=off|test|on] [testers=a,b]");
  }
  const opt = Object.fromEntries(rest.map(a => a.split("=")).filter(kv => kv.length === 2));
  const before = settings.instagram ?? {};
  const agent = opt.agent ?? before.agent ?? "off";
  if (!["off", "test", "on"].includes(agent)) throw new Error("agent must be off, test or on");
  const testers = opt.testers !== undefined ? opt.testers.split(",").map((t: string) => t.trim()).filter((t: string) => /^\d{5,25}$/.test(t)) : (before.testers ?? []);
  settings.instagram = { igUserId, username: username.replace(/^@/, ""), enabled: mode === "on", agent, testers };
  await prisma.business.update({ where: { id: biz.id }, data: { settings: JSON.stringify(settings) } });
  console.log(biz.name, "instagram:", JSON.stringify(before), "→", JSON.stringify(settings.instagram));
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
