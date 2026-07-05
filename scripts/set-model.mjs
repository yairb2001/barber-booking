import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const BIZ_ID = "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2";
const NEW_MODEL = process.argv[2] || "gpt-4o";
async function withRetry(fn, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}
async function main() {
  const biz = await withRetry(() => prisma.business.findUnique({ where: { id: BIZ_ID }, select: { settings: true } }));
  let s = {}; try { s = JSON.parse(biz.settings || "{}"); } catch {}
  const before = s.openaiModel;
  s.openaiModel = NEW_MODEL;
  s.aiProvider = "openai";
  await withRetry(() => prisma.business.update({ where: { id: BIZ_ID }, data: { settings: JSON.stringify(s) } }));
  console.log(`model: ${before} -> ${s.openaiModel}  (provider=${s.aiProvider})`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
