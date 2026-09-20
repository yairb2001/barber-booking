/**
 * Replay REAL past conversations against the live prompt and the candidate one.
 *
 *   npx tsx scripts/replay-real.ts --corpus <corpus.json> --out <dir> [--n 8] [--variants live,candidate] [--ids a,b,c]
 *   env: REPLAY_BASE (default https://barber-booking-indol.vercel.app), REPLAY_SESSION (owner admin_session JWT)
 *
 * For each selected episode the customer's own messages are sent, one by one,
 * to POST /api/admin/agent/test {action:"turn"} in sandbox mode on production
 * (real API key, real DB for context, simulated mutations, throw-away phone,
 * cleaned up after). Both variants see the same customer context (contextPhone)
 * and the same scripted turns. Output: JSON + a Markdown side-by-side report
 * with rule checks. Cost of the run is printed (usage kind "sandbox").
 *
 * Known limit of scripted replay: the customer's later messages answered the
 * OLD agent; when the candidate replies differently, a scripted "כן" may not fit.
 * The report flags such turns; read them, don't score them blindly.
 */
import * as fs from "node:fs";
import * as path from "node:path";

type Msg = { t: string; role: string; tool?: string; input?: string; text: string };
type Episode = { conversationId: string; phone: string; name: string | null; start: string; calls: number; cost: number; outcome: string; proactiveFirst: boolean; userTurns: number; transcript: Msg[] };
type TurnResult = { text: string; replies: string[]; tools: { name: string; input: string | null; result: string }[]; toolLog: string[]; usage: { calls: number; costUsd: number; cacheWrite: number; cacheRead: number; output: number }; ms: number; error?: string };
type VariantRun = { variant: string; turns: TurnResult[]; calls: number; costUsd: number; flags: string[] };

const args: Record<string, string> = Object.fromEntries(process.argv.slice(2).map((a, i, arr): [string, string] | [] => a.startsWith("--") ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"] : []).filter((x): x is [string, string] => x.length === 2));
const BASE = process.env.REPLAY_BASE ?? "https://barber-booking-indol.vercel.app";
const SESSION = process.env.REPLAY_SESSION ?? (fs.existsSync("/tmp/claude-501/owner-session.txt") ? fs.readFileSync("/tmp/claude-501/owner-session.txt", "utf8").trim() : "");
if (!SESSION) { console.error("REPLAY_SESSION missing"); process.exit(1); }
const corpus: Episode[] = JSON.parse(fs.readFileSync(args.corpus, "utf8"));
const outDir = args.out; fs.mkdirSync(outDir, { recursive: true });
const N = Number(args.n ?? 8);
const VARIANTS = (args.variants ?? "live,candidate").split(",");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function api(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/admin/agent/test`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `admin_session=${SESSION}` }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

function pick(): Episode[] {
  if (args.ids) { const ids = args.ids.split(","); return corpus.filter(e => ids.some((id: string) => e.conversationId.startsWith(id))); }
  const ok = corpus.filter(e => e.userTurns >= 1 && e.userTurns <= 9 && !/^\W*$/.test(e.transcript.find(m => m.role === "user")?.text ?? ""));
  const groups = new Map<string, Episode[]>();
  for (const e of ok) { const k = e.proactiveFirst ? "nudge" : e.outcome; (groups.get(k) ?? groups.set(k, []).get(k)!).push(e); }
  for (const g of Array.from(groups.values())) g.sort((a: Episode, b: Episode) => b.start.localeCompare(a.start)); // newest first
  const order = ["booked", "nothing", "nudge", "info", "move", "escalated", "waitlist", "cancel"];
  const out: Episode[] = [];
  while (out.length < N) {
    let added = false;
    for (const k of order) { const g = groups.get(k); if (g?.length && out.length < N) { out.push(g.shift()!); added = true; } }
    if (!added) break;
  }
  return out;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function check(run: VariantRun): string[] {
  const flags: string[] = [];
  let askedConfirm = false;
  run.turns.forEach((t, i) => {
    const text = t.replies.join("\n");
    const booked = t.tools.some(x => x.name === "book_appointment" && x.result.startsWith("✅"));
    const bookCall = t.tools.some(x => x.name === "book_appointment") || t.toolLog.some(l => l.startsWith("book_appointment"));
    if (bookCall && !askedConfirm && !/מתאים\?|מאשר\?/.test(run.turns.slice(0, i).map(x => x.replies.join(" ")).join(" "))) flags.push(`turn ${i + 1}: book_appointment בלי שאלת אישור קודמת`);
    if (/קבעתי|סגור,|נקבע לך|העברתי/.test(text) && !booked && !t.toolLog.some(l => /^(book_appointment|request_appointment_move)/.test(l))) flags.push(`turn ${i + 1}: "קבעתי/סגור" בלי ✅ מכלי`);
    if (/הנחה|קופון|מבצע|מחיר מיוחד/.test(text.replace(/אין (לנו |לי )?(הנחות|הנחה|מבצעים|קופונים)/g, ""))) flags.push(`turn ${i + 1}: הנחה/קופון בתשובה`);
    if (UUID.test(text)) flags.push(`turn ${i + 1}: מזהה דלף ללקוח`);
    if (/איך אפשר לעזור/.test(text)) flags.push(`turn ${i + 1}: "איך אפשר לעזור"`);
    if (t.replies.some(r => r.length > 350)) flags.push(`turn ${i + 1}: תשובה ארוכה (${Math.max(...t.replies.map(r => r.length))} תווים)`);
    if (t.error) flags.push(`turn ${i + 1}: שגיאה ${t.error}`);
    if (/מאשר\?|מתאים\?/.test(text)) askedConfirm = true;
  });
  return flags;
}

async function replay(ep: Episode, variant: string): Promise<VariantRun> {
  const phone = "9725099" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  const contextPhone = ep.phone.replace(/^0/, "972").replace(/\D/g, "");
  const turns: TurnResult[] = [];
  try {
    for (const m of ep.transcript.filter(x => x.role === "user")) {
      const text = m.text.trim(); if (!text) continue;
      try {
        const r = await api({ action: "turn", phone, text, variant, contextPhone });
        turns.push({ text, replies: r.replies ?? [], tools: r.tools ?? [], toolLog: r.toolLog ?? [], usage: r.usage, ms: r.ms });
      } catch (e) {
        turns.push({ text, replies: [], tools: [], toolLog: [], usage: { calls: 0, costUsd: 0, cacheWrite: 0, cacheRead: 0, output: 0 }, ms: 0, error: e instanceof Error ? e.message : String(e) });
        break;
      }
      await sleep(300);
    }
  } finally { await api({ action: "cleanup", phone }).catch(() => {}); }
  const run: VariantRun = { variant, turns, calls: turns.reduce((s, t) => s + t.usage.calls, 0), costUsd: turns.reduce((s, t) => s + t.usage.costUsd, 0), flags: [] };
  run.flags = check(run);
  return run;
}

(async () => {
  const eps = pick();
  console.log(`replaying ${eps.length} episodes × ${VARIANTS.join("/")} against ${BASE}`);
  const results: { episode: Episode; runs: VariantRun[] }[] = [];
  for (const ep of eps) {
    const runs: VariantRun[] = [];
    for (const v of VARIANTS) {
      const r = await replay(ep, v);
      runs.push(r);
      console.log(`  ${ep.start.slice(5, 16)} ${ep.outcome.padEnd(9)} ${v.padEnd(9)} calls=${String(r.calls).padStart(2)} $${r.costUsd.toFixed(3)} flags=${r.flags.length}`);
    }
    results.push({ episode: ep, runs });
    fs.writeFileSync(path.join(outDir, "replay.json"), JSON.stringify(results, null, 1));
  }
  // ── Markdown report ──
  const L: string[] = [`# Replay של שיחות אמיתיות — ${new Date().toISOString().slice(0, 16)}`, ""];
  L.push("| וריאנט | שיחות | קריאות (סה\"כ) | קריאות לשיחה | עלות | דגלים |", "|---|---|---|---|---|---|");
  for (const v of VARIANTS) {
    const rs = results.map(r => r.runs.find(x => x.variant === v)!);
    const calls = rs.reduce((s, r) => s + r.calls, 0), cost = rs.reduce((s, r) => s + r.costUsd, 0), flags = rs.reduce((s, r) => s + r.flags.length, 0);
    L.push(`| ${v} | ${rs.length} | ${calls} | ${(calls / rs.length).toFixed(1)} | $${cost.toFixed(3)} | ${flags} |`);
  }
  L.push("", `מקור: ${results.length} שיחות אמיתיות, ${results.reduce((s, r) => s + r.episode.calls, 0)} קריאות במקור ($${results.reduce((s, r) => s + r.episode.cost, 0).toFixed(3)}).`, "");
  for (const { episode: ep, runs } of results) {
    L.push(`## ${ep.start.slice(0, 16).replace("T", " ")} · ${ep.outcome}${ep.proactiveFirst ? " · אחרי נודניק" : ""} · במקור ${ep.calls} קריאות`, "");
    const turns = ep.transcript.filter(m => m.role === "user");
    turns.forEach((m, i) => {
      L.push(`**👤 ${m.text.replace(/\n/g, " ")}**`, "");
      for (const r of runs) {
        const t = r.turns[i];
        if (!t) { L.push(`- ${r.variant}: —`); continue; }
        const tools = t.tools.map(x => x.name).concat(t.toolLog.map(l => `[sim] ${l.split("(")[0]}`)).join(", ");
        L.push(`- **${r.variant}** (${t.usage.calls} קריאות${tools ? `; כלים: ${tools}` : ""})${t.error ? ` ⚠️ ${t.error}` : ""}`);
        for (const rep of t.replies) L.push(`  > ${rep.replace(/\n/g, " / ")}`);
      }
      L.push("");
    });
    for (const r of runs) if (r.flags.length) L.push(`- ⚑ ${r.variant}: ${r.flags.join(" · ")}`);
    L.push("");
  }
  fs.writeFileSync(path.join(outDir, "replay-report.md"), L.join("\n"));
  console.log("report:", path.join(outDir, "replay-report.md"));
})().catch(e => { console.error(e); process.exit(1); });
