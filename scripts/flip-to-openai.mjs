import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BIZ_ID = "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2";

async function withRetry(fn, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === tries - 1) throw e;
      console.log(`retry ${i + 1} after error: ${e.message?.slice(0, 80)}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function main() {
  const biz = await withRetry(() =>
    prisma.business.findUnique({ where: { id: BIZ_ID }, select: { settings: true } })
  );
  if (!biz) throw new Error("business not found");

  let settings = {};
  if (biz.settings) {
    try { settings = JSON.parse(biz.settings); } catch { settings = {}; }
  }

  const before = { aiProvider: settings.aiProvider, openaiModel: settings.openaiModel };
  settings.aiProvider = "openai";
  settings.openaiModel = "gpt-4o-mini";

  await withRetry(() =>
    prisma.business.update({
      where: { id: BIZ_ID },
      data: { settings: JSON.stringify(settings) },
    })
  );

  console.log("BEFORE:", JSON.stringify(before));
  console.log("AFTER :", JSON.stringify({ aiProvider: settings.aiProvider, openaiModel: settings.openaiModel }));
  console.log("✅ flipped to OpenAI (gpt-4o-mini)");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
