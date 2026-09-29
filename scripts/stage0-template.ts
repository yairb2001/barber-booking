/**
 * Stage 0 (docs/PLAN-MASTER.md): move a business from a hand-copied prompt to
 * the compact template (prompt-template.ts) — and back.
 *
 *   npx tsx --env-file=.env scripts/stage0-template.ts status  <slug>
 *   npx tsx --env-file=.env scripts/stage0-template.ts migrate <slug>            # backup prompt → systemPrompt = null (template) + type
 *   npx tsx --env-file=.env scripts/stage0-template.ts rollback <backup.json>    # restore the backed-up prompt
 *   npx tsx --env-file=.env scripts/stage0-template.ts render  <slug>            # print the prompt the business gets now
 *   npx tsx --env-file=.env scripts/stage0-template.ts preview <slug>            # print the prompt it WOULD get on the template (no DB change)
 *
 * Backups go to prompt-backups/<slug>-prompt-<timestamp>.json with a sha256.
 * "migrate" never touches a business whose slug is "dominant" (hand-tuned live prompt).
 */
import { prisma } from "../src/lib/prisma";
import { buildSystemPrompt, stablePromptParams, buildCatalogBlock, promptFlagsFor, selectTools, AGENT_TOOLS } from "../src/lib/agent/customer-agent";
import { buildBookingLink } from "../src/lib/link-first";
import { isBusinessType } from "../src/lib/vocab";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

async function load(slug: string) {
  const biz = await prisma.business.findFirst({ where: { slug }, select: { id: true, name: true, slug: true, settings: true, businessType: true } });
  if (!biz) throw new Error(`business not found: ${slug}`);
  const cfg = await prisma.agentConfig.findUnique({ where: { businessId: biz.id }, include: { faqs: { orderBy: { sortOrder: "asc" } } } });
  return { biz, cfg };
}

async function render(slug: string, asTemplate = false) {
  const { biz, cfg: loaded } = await load(slug);
  const cfg = asTemplate && loaded ? { ...loaded, systemPrompt: null } : loaded;
  const [catalog, link] = await Promise.all([buildCatalogBlock(biz.id), buildBookingLink(biz)]);
  const blocks = buildSystemPrompt({ ...stablePromptParams(biz, cfg, catalog, link), now: "(עכשיו)" });
  const flags = promptFlagsFor(biz.settings, { hasCustomPrompt: !!cfg?.systemPrompt?.trim() });
  const tools = selectTools(AGENT_TOOLS, { v3: flags.v3, hasCatalog: !!catalog });
  return { biz, cfg, stable: blocks[0].text, flags, tools: tools.map(t => t.name) };
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "status" || cmd === "render" || cmd === "preview") {
    const r = await render(arg, cmd === "preview");
    console.log(`${r.biz.name} (${r.biz.slug}) type=${r.biz.businessType} custom=${r.cfg?.systemPrompt?.length ?? 0} chars, faqs=${r.cfg?.faqs.length ?? 0}, setup=${!!r.cfg?.setupConfig}`);
    console.log(`flags: ${JSON.stringify(r.flags)} · tools (${r.tools.length}): ${r.tools.join(", ")}`);
    console.log(`stable prefix: ${r.stable.length} chars`);
    if (cmd === "render" || cmd === "preview") { console.log("\n" + "─".repeat(60) + "\n" + r.stable + "\n" + "─".repeat(60)); }
    return;
  }
  if (cmd === "migrate") {
    if (arg === "dominant") throw new Error("refusing to touch the hand-tuned live prompt of dominant");
    const type = process.argv[4];
    const { biz, cfg } = await load(arg);
    if (!cfg) throw new Error("no agent config");
    const backup = { slug: biz.slug, businessId: biz.id, at: new Date().toISOString(), systemPrompt: cfg.systemPrompt, sha256: cfg.systemPrompt ? sha(cfg.systemPrompt) : null, settings: biz.settings, businessType: biz.businessType };
    const file = path.join("prompt-backups", `${biz.slug}-prompt-${backup.at.replace(/[:.]/g, "-")}.json`);
    fs.mkdirSync("prompt-backups", { recursive: true });
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    await prisma.agentConfig.update({ where: { businessId: biz.id }, data: { systemPrompt: null } });
    if (type && isBusinessType(type)) await prisma.business.update({ where: { id: biz.id }, data: { businessType: type } });
    console.log(`backup → ${file}\nsystemPrompt cleared → template${type ? `, businessType=${type}` : ""}`);
    const r = await render(arg);
    console.log(`now: flags=${JSON.stringify(r.flags)} tools=${r.tools.length} stable=${r.stable.length} chars`);
    return;
  }
  if (cmd === "rollback") {
    const b = JSON.parse(fs.readFileSync(arg, "utf8")) as { businessId: string; systemPrompt: string | null; sha256: string | null; businessType?: string };
    if (b.systemPrompt && sha(b.systemPrompt) !== b.sha256) throw new Error("backup sha mismatch");
    await prisma.agentConfig.update({ where: { businessId: b.businessId }, data: { systemPrompt: b.systemPrompt } });
    if (b.businessType) await prisma.business.update({ where: { id: b.businessId }, data: { businessType: b.businessType } });
    console.log(`restored ${b.systemPrompt?.length ?? 0} chars`);
    return;
  }
  throw new Error("usage: status|render|migrate|rollback");
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
