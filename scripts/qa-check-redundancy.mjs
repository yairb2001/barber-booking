// Redundancy check for a proposed prompt rule (run BEFORE creating a QA
// suggestion of klass "prompt"). Surfaces the existing prompt lines most related
// to the proposal so Claude Code can judge — on the subscription — whether the
// rule is already covered, and avoid bloating the prompt with a paraphrase.
//
//   node --env-file=.env scripts/qa-check-redundancy.mjs "<proposed rule text>"
//   (or put the rule in /tmp/proposed-rule.txt and run with no arg)
import { PrismaClient } from "@prisma/client";
import fs from "fs";

const p = new PrismaClient();
const BIZ = "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2";
const rule = (process.argv[2] || (fs.existsSync("/tmp/proposed-rule.txt") ? fs.readFileSync("/tmp/proposed-rule.txt", "utf8") : "")).trim();
if (!rule) { console.error("no rule text given (arg or /tmp/proposed-rule.txt)"); process.exit(1); }

const cfg = await p.agentConfig.findFirst({ where: { businessId: BIZ }, select: { systemPrompt: true } });
const prompt = cfg.systemPrompt || "";

// Distinctive tokens: Hebrew words 3+ chars, tool names, and ✅.
const stop = new Set(["אתה","ללקוח","הלקוח","לפני","שאתה","אם","או","של","עם","זה","את","גם","לא","אל","כי","יש","על","כדי","הוא","היא","אבל","רק","מה","כבר"]);
const tokens = Array.from(new Set(
  (rule.match(/[֐-׿]{3,}|book_appointment|get_available_slots|find_next_available|check_appointment|✅/g) || [])
    .filter(t => !stop.has(t))
));

const lines = prompt.split("\n").map((text, i) => {
  const hits = tokens.filter(t => text.includes(t)).length;
  return { i, text: text.trim(), hits };
}).filter(l => l.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 8);

console.log("=== Proposed rule ===\n" + rule + "\n");
console.log(`=== Distinctive tokens (${tokens.length}) ===\n` + tokens.join(", ") + "\n");
console.log("=== Most-related existing prompt lines (verify redundancy) ===");
if (!lines.length) console.log("(none — likely a genuinely new rule)");
for (const l of lines) console.log(`  [${l.hits} hits] ${l.text.slice(0, 170)}`);
console.log(`\nprompt length: ${prompt.length} chars` + (prompt.length > 16000 ? "  ⚠️ consider consolidation" : ""));
console.log("\n→ If a line above already says the same thing, DON'T create the suggestion (or strengthen that line instead of appending).");
await p.$disconnect();
