// Before/after cost + reliability metrics for the customer agent, measured
// against REAL conversations (agent_usage + appointments), not synthetic
// scenarios. Built for the LLM cost-reduction project (2026-09-19): every
// lever change gets a "week before" vs "week after" run of this script on
// real traffic, on top of (not instead of) test-prompt-routing.ts passing.
//
//   node --env-file=.env scripts/measure-agent-metrics.mjs [since] [until]
//   dates: YYYY-MM-DD (UTC midnight). Defaults to the whole current month so far.
//
// Output: Hebrew report to stdout + machine-readable JSON at /tmp/agent-metrics.json
import { PrismaClient } from "@prisma/client";
import fs from "fs";

const prisma = new PrismaClient();
const BIZ = "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2"; // DOMINANT

const args = process.argv.slice(2);
const since = args[0] ? new Date(args[0]) : new Date(new Date().toISOString().slice(0, 8) + "01T00:00:00Z");
const until = args[1] ? new Date(args[1]) : new Date();

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
const money = (n) => `$${n.toFixed(4)}`;
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "0%");

async function main() {
  // Every usage row for the customer agent in the window, tagged to a conversation.
  const usage = await prisma.agentUsage.findMany({
    where: {
      businessId: BIZ,
      kind: "customer",
      conversationId: { not: null },
      createdAt: { gte: since, lt: until },
    },
    select: { conversationId: true, costUsd: true, model: true, createdAt: true },
  });

  if (!usage.length) {
    console.log(`אין נתוני agent_usage בטווח ${since.toISOString()} .. ${until.toISOString()}`);
    await prisma.$disconnect();
    return;
  }

  // Group by conversation.
  const byConv = new Map();
  for (const u of usage) {
    const rec = byConv.get(u.conversationId) || { calls: 0, cost: 0, models: {} };
    rec.calls += 1;
    rec.cost += u.costUsd;
    rec.models[u.model] = (rec.models[u.model] || 0) + 1;
    byConv.set(u.conversationId, rec);
  }
  const convIds = [...byConv.keys()];
  const costs = convIds.map(id => byConv.get(id).cost);
  const calls = convIds.map(id => byConv.get(id).calls);

  // Escalation status for exactly those conversations (not all conversations ever).
  const convos = await prisma.conversation.findMany({
    where: { id: { in: convIds } },
    select: { id: true, escalatedAt: true, status: true },
  });
  const escalatedCount = convos.filter(c => c.escalatedAt !== null).length;

  // Broader denominator: ALL customer conversation threads touched in the window,
  // including ones with zero LLM calls in-window (e.g. automated reminder/nudge
  // sends that bump lastMessageAt without invoking the paid agent). This is what
  // "conversation volume" usually means colloquially — kept separate from the
  // cost/calls stats above, which can only be computed over LLM-active conversations.
  const allTouched = await prisma.conversation.count({
    where: { businessId: BIZ, agentType: "customer", lastMessageAt: { gte: since, lt: until } },
  });
  const allTouchedEscalated = await prisma.conversation.count({
    where: { businessId: BIZ, agentType: "customer", lastMessageAt: { gte: since, lt: until }, escalatedAt: { not: null } },
  });

  // Appointments actually booked by the agent in the same window.
  const appts = await prisma.appointment.count({
    where: { businessId: BIZ, source: "agent", createdAt: { gte: since, lt: until } },
  });

  // Model mix, for visibility into lever #3 (Haiku vs Sonnet) specifically.
  const modelTotals = {};
  for (const u of usage) modelTotals[u.model] = (modelTotals[u.model] || 0) + 1;

  const totalCost = costs.reduce((a, b) => a + b, 0);

  const report = {
    since: since.toISOString(),
    until: until.toISOString(),
    llmActiveConversations: convIds.length,
    allTouchedConversations: allTouched,
    totalCostUsd: Number(totalCost.toFixed(4)),
    avgCostPerConvo: Number(mean(costs).toFixed(4)),
    medianCostPerConvo: Number(median(costs).toFixed(4)),
    avgCallsPerConvo: Number(mean(calls).toFixed(2)),
    escalatedConvos: escalatedCount,
    escalationRateOfLlmActive: convIds.length ? escalatedCount / convIds.length : 0,
    escalationRateOfAllTouched: allTouched ? allTouchedEscalated / allTouched : 0,
    appointmentsBooked: appts,
    appointmentRateOfLlmActive: convIds.length ? appts / convIds.length : 0,
    modelMix: modelTotals,
  };

  console.log(`\n📊 מדדי סוכן — ${since.toISOString().slice(0, 10)} עד ${until.toISOString().slice(0, 10)}\n`);
  console.log(`שיחות עם קריאת מודל בטווח (הבסיס לחישובי עלות/קריאות): ${report.llmActiveConversations}`);
  console.log(`כלל השיחות שנגעו בתקופה (כולל תזכורות אוטומטיות בלי קריאת LLM): ${report.allTouchedConversations}`);
  console.log(`עלות כוללת: ${money(report.totalCostUsd)}`);
  console.log(`עלות ממוצעת לשיחה: ${money(report.avgCostPerConvo)}`);
  console.log(`עלות חציונית לשיחה: ${money(report.medianCostPerConvo)}`);
  console.log(`קריאות מודל ממוצע לשיחה: ${report.avgCallsPerConvo}`);
  console.log(`הסלמות מתוך שיחות פעילות-LLM: ${report.escalatedConvos}/${report.llmActiveConversations} (${pct(report.escalatedConvos, report.llmActiveConversations)})`);
  console.log(`הסלמות מתוך כלל השיחות שנגעו: ${allTouchedEscalated}/${report.allTouchedConversations} (${pct(allTouchedEscalated, report.allTouchedConversations)})`);
  console.log(`תורים שנקבעו ע"י הסוכן: ${report.appointmentsBooked} (${pct(report.appointmentsBooked, report.llmActiveConversations)} משיחות פעילות-LLM)`);
  console.log(`תמהיל מודלים: ${JSON.stringify(report.modelMix)}`);

  fs.writeFileSync("/tmp/agent-metrics.json", JSON.stringify(report, null, 2));
  console.log(`\nנשמר: /tmp/agent-metrics.json`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
