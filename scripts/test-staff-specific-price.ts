/**
 * Live functional test for the staff-specific-price prompt fix (2026-08-30).
 * Reproduces the Roey Carmi case: once a specific barber (Yair Buchbut) is
 * already established in the conversation, a price question about "him"
 * must use get_services(staffId) — not the flat "מה המחיר?" FAQ (90) that
 * doesn't reflect his higher base price (150, no team discount applied).
 *
 * Temporarily patches the business's live AgentConfig.systemPrompt with the
 * candidate wording, runs the scenario against the real DOMINANT business
 * (Nitai's real staff phone as the "customer" — approved test contact per
 * TOOLS.md), then ALWAYS restores the original prompt at the end regardless
 * of pass/fail. Deletes the throwaway conversation it creates. No permanent
 * change is left behind by this script — that only happens after Yair
 * approves and the change is applied for real.
 *
 * Usage: npx tsx --env-file=.env scripts/test-staff-specific-price.ts
 */
import { PrismaClient } from "@prisma/client";
import { runCustomerAgent } from "../src/lib/agent/customer-agent";

const prisma = new PrismaClient();
const BIZ_ID = "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2";
const TEST_PHONE = "972587766730"; // Nitai's real staff phone, used as customer-agent test contact

const OLD_BULLET = `⚠️ שאלת מחיר כללית, בלי שהלקוח ציין ספר ספציפי (למשל "כמה עולה תספורת?" או "כמה עולה תספורת מספריים?") — ענה מה-FAQ המתאים לשירות שנשאל עליו (יש FAQ נפרד ל"תספורת + זקן" ול"תספורת מספריים/מייקאובר/חתן"), אל תקרא ל-get_services בלי staffId בשביל זה. המחיר הבסיסי במערכת שווה למחיר של יאיר בוחבוט באופן ספציפי, לא למחיר הנפוץ שרוב הצוות גובה בפועל — אז תשובה כללית מ-get_services בלי ספר עלולה להטעות. קרא ל-get_services עם staffId (ולתת את המחיר המדויק שלו) רק אם הלקוח ציין ספר מסוים, או כשאתה כבר בתהליך קביעה בפועל וצריך את המחיר המדויק לצורך הקביעה עצמה.`;

const NEW_BULLET = `⚠️ שאלת מחיר: אם אין עדיין ספר ספציפי בהקשר השיחה (הלקוח לא ציין ולא בחר ספר, ואתה לא הצעת לו שעה אצל ספר מסוים) — ענה מה-FAQ המתאים לשירות שנשאל עליו, ואל תקרא ל-get_services בלי staffId בשביל זה (המחיר הבסיסי שנשמר בשירות עצמו שווה למחיר של יאיר בוחבוט באופן ספציפי, לא למחיר הנפוץ שרוב הצוות גובה בפועל — אז זה יטעה). אבל אם כן יש כבר ספר ספציפי בהקשר השיחה — הלקוח ציין את שמו, או שהוא מתייחס אליו במרומז ("הוא"/"אצלו") אחרי שכבר דיברתם עליו (למשל הצעת לו שעה אצלו) — קרא ל-get_services עם ה-staffId שלו וענה עם המחיר המדויק שהכלי מחזיר, גם אם זה שונה מה-FAQ (למשל אצל יאיר בוחבוט המחיר גבוה יותר — 150₪ ולא 90). לעולם אל תגיד מחיר שסותר את מה שהלקוח עצמו אומר לך בלי לבדוק קודם עם get_services מול ה-staffId הספציפי, ואל תתעקש שמחיר אחר "לא מעודכן" בלי לבדוק.`;

async function send(text: string) {
  console.log(`\n>>> customer: ${text}`);
  await runCustomerAgent({ businessId: BIZ_ID, phone: TEST_PHONE, incomingText: text });
  const conv = await prisma.conversation.findFirst({ where: { businessId: BIZ_ID, phone: TEST_PHONE } });
  const last = await prisma.conversationMessage.findMany({
    where: { conversationId: conv!.id },
    orderBy: { createdAt: "desc" },
    take: 4,
  });
  last.reverse().forEach(m => console.log(`    [${m.source}] ${m.content.slice(0, 300)}`));
  return last;
}

async function main() {
  const cfg = await prisma.agentConfig.findUniqueOrThrow({ where: { businessId: BIZ_ID } });
  if (!cfg.systemPrompt || !cfg.systemPrompt.includes(OLD_BULLET)) {
    throw new Error("OLD_BULLET not found verbatim in live systemPrompt — aborting before touching prod config");
  }
  const patchedPrompt = cfg.systemPrompt.replace(OLD_BULLET, NEW_BULLET);
  await prisma.agentConfig.update({ where: { businessId: BIZ_ID }, data: { systemPrompt: patchedPrompt } });
  console.log("patched live systemPrompt with candidate wording (will restore at the end)");

  // Clean slate for this test phone.
  const existing = await prisma.conversation.findFirst({ where: { businessId: BIZ_ID, phone: TEST_PHONE } });
  if (existing) {
    await prisma.conversationMessage.deleteMany({ where: { conversationId: existing.id } });
    await prisma.conversation.delete({ where: { id: existing.id } });
  }

  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(tomorrow);
  console.log("test date:", iso);

  await send(`מה השעות הפנויות ב-${iso} אצל יאיר בוחבוט?`);
  const msgs = await send("כמה זה עולה אצלו?");

  const combined = msgs.filter(m => m.source === "agent").map(m => m.content).join(" | ");
  console.log("\n=== RESULT ===");
  console.log("agent replies this turn:", combined);
  if (combined.includes("150")) {
    console.log("✅ PASS — agent quoted the correct staff-specific price (150)");
  } else if (combined.includes("90")) {
    console.log("❌ FAIL — agent quoted the flat FAQ price (90) instead of Yair Buchbut's actual price (150)");
    process.exitCode = 1;
  } else {
    console.log("⚠️ inconclusive — no price number found in reply, check manually");
    process.exitCode = 1;
  }
}

main()
  .catch(err => { console.error("\n❌ TEST ERROR:", err); process.exitCode = 1; })
  .finally(async () => {
    const conv = await prisma.conversation.findFirst({ where: { businessId: BIZ_ID, phone: TEST_PHONE } });
    if (conv) {
      await prisma.conversationMessage.deleteMany({ where: { conversationId: conv.id } });
      await prisma.conversation.delete({ where: { id: conv.id } });
    }
    const orig = await prisma.agentConfig.findUniqueOrThrow({ where: { businessId: BIZ_ID } });
    if (orig.systemPrompt?.includes("אם אין עדיין ספר ספציפי בהקשר השיחה")) {
      const restored = orig.systemPrompt.replace(NEW_BULLET, OLD_BULLET);
      await prisma.agentConfig.update({ where: { businessId: BIZ_ID }, data: { systemPrompt: restored } });
      console.log("restored original systemPrompt");
    }
    await prisma.$disconnect();
  });
