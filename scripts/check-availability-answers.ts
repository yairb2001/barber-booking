/**
 * Grades replayed availability answers against the REAL availability (same
 * index the agent uses). Usage: npx tsx --env-file=.env scripts/check-availability-answers.ts <replay.json> [--verbose]
 * Flags: invented = a time in the reply that is not free that day for any barber;
 *        false-none = the reply says "אין" while the asked day/range/barber has free slots.
 */
import * as fs from "fs";
import { prisma } from "../src/lib/prisma";
import { buildAvailabilityIndex } from "../src/lib/availability-index";
import { parseAvailabilityAsk } from "../src/lib/agent/availability-focus";
import { getBusinessNow } from "../src/lib/utils";

const BID = "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2";
const file = process.argv[2]; const verbose = process.argv.includes("--verbose");
type Turn = { text: string; replies: string[]; tools: string[]; usage?: { calls?: number; costUsd?: number } };
type Run = { variant: string; turns: Turn[] };
type Row = { episode: { conversationId: string; name: string | null; start: string; calls: number }; runs: Run[] };
const NONE = /אין (לנו |לו |לה |לי |שום |כלום|מקום|פנוי|אפשרות|תור|כבר)|לא פנוי|אין אחרי|אין לפני|אין בערב|אין בבוקר|אין בצהריים|לא נשאר|אין יותר|זה הכל/;
(async () => {
  const rows: Row[] = JSON.parse(fs.readFileSync(file, "utf8"));
  const today = getBusinessNow().date;
  const index = await buildAvailabilityIndex(BID, today, 6);
  const svc = await prisma.service.findFirst({ where: { businessId: BID, isVisible: true }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  const staff = index.staff.map(s => ({ id: s.id, name: s.name }));
  const tot: Record<string, { eps: number; calls: number; cost: number; asks: number; invented: number; falseNone: number; toolAsks: number }> = {};
  for (const r of rows) for (const run of r.runs) {
    const t = (tot[run.variant] ??= { eps: 0, calls: 0, cost: 0, asks: 0, invented: 0, falseNone: 0, toolAsks: 0 }); t.eps++;
    const lines: string[] = [];
    for (const turn of run.turns) {
      t.calls += turn.usage?.calls ?? 0; t.cost += turn.usage?.costUsd ?? 0;
      const ask = parseAvailabilityAsk(turn.text, today, 6, staff);
      if (!ask) continue;
      t.asks++;
      if (turn.tools.some(x => /get_available_slots|find_next_available/.test(x))) t.toolAsks++;
      const reply = turn.replies.join(" ");
      const inRange = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); const mm = h * 60 + m; return (ask.from === undefined || mm >= ask.from) && (ask.to === undefined || mm < ask.to); };
      const pool = index.staff.filter(s => !ask.staffHint || s.id === ask.staffHint);
      const truth = new Set<string>(); const anyDay = new Set<string>();
      for (const iso of ask.days) for (const s of pool) for (const sl of index.slots(s.id, iso, svc?.id ?? null)) { anyDay.add(sl); if (inRange(sl)) truth.add(sl); }
      const flags: string[] = [];
      const explicitDay = ask.dayLabel !== "בימים הקרובים";
      if (explicitDay && ask.days.length === 1) {
        const mentioned = Array.from(reply.matchAll(/(?:^|[^\d:])(\d{1,2}):(\d{2})(?!\d)/g)).map(m => `${m[1].padStart(2, "0")}:${m[2]}`);
        const bad = mentioned.filter(x => !anyDay.has(x) && !new Set(index.staff.flatMap(s => Array.from({ length: 6 }, (_, d) => index.slots(s.id, addDays(today, d), svc?.id ?? null)).flat())).has(x));
        if (bad.length) flags.push(`invented ${bad.join(",")}`);
      }
      if (explicitDay && truth.size && NONE.test(reply) && !Array.from(truth).some(x => reply.includes(x))) flags.push(`false-none (free: ${Array.from(truth).slice(0, 5).join(",")})`);
      if (flags.some(f => f.startsWith("invented"))) t.invented++;
      if (flags.some(f => f.startsWith("false-none"))) t.falseNone++;
      if (verbose || flags.length) lines.push(`   👤 ${turn.text.slice(0, 60)}  → ${reply.replace(/\s+/g, " ").slice(0, 110)}${flags.length ? "\n      ⚑ " + flags.join("; ") : ""}`);
    }
    if (lines.length) console.log(`\n${r.episode.start.slice(5)} ${r.episode.name ?? "?"} [${run.variant}]\n${lines.join("\n")}`);
  }
  for (const [v, t] of Object.entries(tot)) console.log(`\n== ${v}: episodes=${t.eps} calls=${t.calls} cost=$${t.cost.toFixed(3)} availability-asks=${t.asks} asks-with-tool-call=${t.toolAsks} invented=${t.invented} false-none=${t.falseNone}`);
  await prisma.$disconnect();
})();
function addDays(iso: string, d: number) { const x = new Date(iso + "T00:00:00.000Z"); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); }
