/**
 * Cost baseline / before-after for the customer agent — from REAL data only.
 *
 *   npx tsx --env-file=.env scripts/measure-agent-cost.ts [since] [until] [businessSlug]
 *   dates: YYYY-MM-DD (business days). Defaults: 1st of the month → today, "dominant".
 *
 * Answers, per conversation: how many model calls, what they cost, how much was
 * cold cache-write vs warm, which model, and what the conversation achieved
 * (booked / cancelled / moved / waitlist / info / nothing). Then rolls up to the
 * numbers the owner cares about: cost per completed booking, calls per booking,
 * cold-start share, wasted calls. Read-only.
 */
import { prisma } from "../src/lib/prisma";
import { AGENT_TOOLS, buildSystemPrompt } from "../src/lib/agent/customer-agent";

const PRICES: Record<string, { in: number; out: number; cacheWrite: number; cacheRead: number }> = {
  "claude-haiku-4-5":  { in: 1.0, out: 5.0,  cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
};
const COLD_WRITE_TOKENS = 12_000; // a cache write this big = the whole stable prefix was re-written
const ILS_PER_USD = 3.3;
const ag = (usd: number) => `${Math.round(usd * ILS_PER_USD * 100)} אג׳`;
const usd = (n: number) => `$${n.toFixed(3)}`;
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "0%");
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p = (a: number[], q: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

type Outcome = "booked" | "cancelled" | "moved" | "waitlist" | "escalated" | "info" | "nothing";

async function main() {
  const [sinceArg, untilArg, slug = "dominant"] = process.argv.slice(2);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const since = new Date((sinceArg ?? today.slice(0, 8) + "01") + "T00:00:00+03:00");
  const until = new Date((untilArg ?? today) + "T23:59:59+03:00");
  const biz = await prisma.business.findFirst({ where: { slug }, select: { id: true, name: true, settings: true } });
  if (!biz) throw new Error("business not found");

  // ── 1. What one call carries ──────────────────────────────────────────────
  const cfg = await prisma.agentConfig.findFirst({ where: { businessId: biz.id }, include: { faqs: true } });
  const blocks = buildSystemPrompt({ agentName: cfg?.agentName ?? "סוכן", businessName: biz.name, customSystemPrompt: cfg?.systemPrompt, faqs: (cfg?.faqs ?? []).map(f => ({ question: f.question, answer: f.answer })), now: "…" });
  const stableChars = blocks[0].text.length, dynamicChars = blocks[1].text.length;
  const toolsJson = JSON.stringify(AGENT_TOOLS);
  console.log(`\n═══ ${biz.name} · ${since.toISOString().slice(0, 10)} → ${until.toISOString().slice(0, 10)} ═══`);
  console.log(`\n1) מה נשלח בכל קריאה (לפני מטמון):`);
  console.log(`   פרומפט קבוע (custom ${cfg?.systemPrompt?.length ?? 0} תווים + FAQ + חוקים קשיחים): ${stableChars} תווים`);
  console.log(`   בלוק דינמי (שעה + הקשר לקוח, לא במטמון): ~${dynamicChars}+ תווים`);
  console.log(`   ${AGENT_TOOLS.length} כלים: ${toolsJson.length} תווים JSON — לפי כלי:`);
  for (const t of [...AGENT_TOOLS].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length))
    console.log(`     ${t.name.padEnd(26)} ${String(JSON.stringify(t).length).padStart(5)} תווים (תיאור ${(t.description ?? "").length})`);

  // ── 2. Usage rows → conversations ────────────────────────────────────────
  const usage = await prisma.agentUsage.findMany({
    where: { businessId: biz.id, kind: "customer", createdAt: { gte: since, lte: until } },
    orderBy: { createdAt: "asc" },
    select: { conversationId: true, model: true, inputTokens: true, outputTokens: true, cacheWriteTokens: true, cacheReadTokens: true, costUsd: true, createdAt: true },
  });
  const convIds = Array.from(new Set(usage.map(u => u.conversationId).filter(Boolean))) as string[];
  const msgs = await prisma.conversationMessage.findMany({
    where: { conversationId: { in: convIds }, createdAt: { gte: since, lte: until } },
    orderBy: { createdAt: "asc" },
    select: { conversationId: true, role: true, source: true, toolName: true, content: true, createdAt: true },
  });
  const msgsBy = new Map<string, typeof msgs>();
  for (const m of msgs) (msgsBy.get(m.conversationId) ?? msgsBy.set(m.conversationId, []).get(m.conversationId)!).push(m);

  // token→cost by component (so we can say WHERE the money goes)
  const comp = { coldWrite: 0, warmWrite: 0, cacheRead: 0, input: 0, output: 0 };
  const byModel = new Map<string, { calls: number; cost: number }>();
  let coldStarts = 0;
  const coldByDay = new Map<string, number>();
  for (const u of usage) {
    const pr = PRICES[u.model] ?? PRICES["claude-sonnet-4-6"];
    const cold = u.cacheWriteTokens >= COLD_WRITE_TOKENS;
    if (cold) { coldStarts++; const d = u.createdAt.toISOString().slice(5, 10); coldByDay.set(d, (coldByDay.get(d) ?? 0) + 1); }
    (cold ? (comp.coldWrite += u.cacheWriteTokens * pr.cacheWrite / 1e6) : (comp.warmWrite += u.cacheWriteTokens * pr.cacheWrite / 1e6));
    comp.cacheRead += u.cacheReadTokens * pr.cacheRead / 1e6;
    comp.input += u.inputTokens * pr.in / 1e6;
    comp.output += u.outputTokens * pr.out / 1e6;
    const m = byModel.get(u.model) ?? { calls: 0, cost: 0 }; m.calls++; m.cost += u.costUsd; byModel.set(u.model, m);
  }
  const total = usage.reduce((s, u) => s + u.costUsd, 0);
  const noConv = usage.filter(u => !u.conversationId);
  // keep-warm pings (stage A of docs/PLAN-COST.md) — separate kind so they never
  // pollute per-conversation numbers; a "miss" = the ping itself paid a cold write.
  const pings = await prisma.agentUsage.findMany({ where: { businessId: biz.id, kind: "cache_warm", createdAt: { gte: since, lte: until } }, select: { costUsd: true, cacheWriteTokens: true, cacheReadTokens: true } });
  const pingMisses = pings.filter(x => x.cacheWriteTokens >= COLD_WRITE_TOKENS).length;
  const agentAppts = await prisma.appointment.count({ where: { businessId: biz.id, source: "agent", createdAt: { gte: since, lte: until } } });
  const agentApptsKept = await prisma.appointment.count({ where: { businessId: biz.id, source: "agent", createdAt: { gte: since, lte: until }, status: { notIn: ["cancelled_by_customer", "cancelled_by_staff"] } } });

  const GAP_MS = 4 * 3600_000;
  type Conv = { id: string; calls: number; cost: number; cold: number; userMsgs: number; outcome: Outcome; tools: string[]; toolErrors: number; proactive: boolean; firstUser: string; sonnetCalls: number };
  const convs: Conv[] = [];
  const episodes: { id: string; rows: typeof usage }[] = [];
  for (const id of convIds) {
    const all = usage.filter(u => u.conversationId === id);
    let cur: typeof usage = [];
    for (const r of all) {
      if (cur.length && r.createdAt.getTime() - cur[cur.length - 1].createdAt.getTime() > GAP_MS) { episodes.push({ id, rows: cur }); cur = []; }
      cur.push(r);
    }
    if (cur.length) episodes.push({ id, rows: cur });
  }
  for (const { id, rows } of episodes) {
    const t0 = rows[0].createdAt.getTime() - 15 * 60_000, t1 = rows[rows.length - 1].createdAt.getTime() + 2 * 60_000;
    const ms = (msgsBy.get(id) ?? []).filter(m => m.createdAt.getTime() >= t0 && m.createdAt.getTime() <= t1);
    const tools = ms.filter(m => m.role === "tool").map(m => m.toolName ?? "?");
    const toolErrors = ms.filter(m => m.role === "tool" && /^שגיאה|לא זיהיתי/.test(m.content)).length;
    const has = (name: string, ok: RegExp) => ms.some(m => m.role === "tool" && m.toolName === name && ok.test(m.content));
    let outcome: Outcome = "info";
    if (has("book_appointment", /✅/) || has("book_for_customer", /✅/)) outcome = "booked";
    else if (has("request_appointment_move", /✅|הועבר|נקבע מחדש|עודכן/)) outcome = "moved";
    else if (has("cancel_appointment", /✅|בוטל/)) outcome = "cancelled";
    else if (has("join_waitlist", /✅|נרשם|נוסף/)) outcome = "waitlist";
    else if (tools.includes("escalate_to_human")) outcome = "escalated";
    else if (tools.some(t => ["get_available_slots", "find_next_available", "find_parallel_slots"].includes(t))) outcome = "nothing";
    const userMsgs = ms.filter(m => m.role === "user");
    const firstMsg = ms[0];
    convs.push({
      id, calls: rows.length, cost: rows.reduce((s, r) => s + r.costUsd, 0), cold: rows.filter(r => r.cacheWriteTokens >= COLD_WRITE_TOKENS).length,
      userMsgs: userMsgs.length, outcome, tools, toolErrors,
      proactive: !!firstMsg && firstMsg.role === "assistant", firstUser: (userMsgs[0]?.content ?? "").slice(0, 60).replace(/\n/g, " "),
      sonnetCalls: rows.filter(r => r.model.includes("sonnet")).length,
    });
  }

  // ── 3. Report ─────────────────────────────────────────────────────────────
  const days = Math.max(1, Math.round((until.getTime() - since.getTime()) / 86400000));
  console.log(`\n2) סה"כ: ${usd(total)} · ${usage.length} קריאות (${noConv.length} בלי שיחה, ${usd(noConv.reduce((s, u) => s + u.costUsd, 0))}) · ${convs.length} אפיזודות-שיחה (אותה שיחה, הפסקה >4ש' = אפיזודה חדשה) · ${days} ימים → ${usd(total / days)}/יום`);
  console.log(`   ★ אמת-מידה: תורים שהסוכן קבע בפועל בתקופה (appointments.source=agent): ${agentAppts}, מהם לא בוטלו ${agentApptsKept} → כל ההוצאה חלקי קביעה = ${usd(total / Math.max(1, agentAppts))} = ${ag(total / Math.max(1, agentAppts))}`);
  console.log(`   לאן הכסף הולך: כתיבת מטמון קרה (התחלה מחדש) ${usd(comp.coldWrite)} (${pct(comp.coldWrite, total)}) · כתיבת היסטוריה ${usd(comp.warmWrite)} (${pct(comp.warmWrite, total)}) · קריאת מטמון ${usd(comp.cacheRead)} (${pct(comp.cacheRead, total)}) · קלט לא-מטמון ${usd(comp.input)} · פלט ${usd(comp.output)} (${pct(comp.output, total)})`);
  if (pings.length) console.log(`   פינגים לשמירת מטמון: ${pings.length} (${(pings.length / days).toFixed(1)}/יום) · עלות ${usd(pings.reduce((s, x) => s + x.costUsd, 0))} · פספוסים (הפינג עצמו שילם כתיבה קרה): ${pingMisses}`);
  console.log(`   התחלות קרות: ${coldStarts} (${(coldStarts / days).toFixed(1)}/יום) · לפי יום: ${Array.from(coldByDay.entries()).map(([d, n]) => `${d}=${n}`).join(" ")}`);
  console.log(`   לפי מודל: ${Array.from(byModel.entries()).map(([m, v]) => `${m.replace("claude-", "")} ${v.calls} קריאות ${usd(v.cost)} (${pct(v.cost, total)})`).join(" · ")}`);

  const by = (o: Outcome) => convs.filter(c => c.outcome === o);
  console.log(`\n3) שיחות לפי תוצאה (שיחות · קריאות חציון/ממוצע · עלות ממוצעת):`);
  for (const o of ["booked", "moved", "cancelled", "waitlist", "escalated", "nothing", "info"] as Outcome[]) {
    const g = by(o); if (!g.length) continue;
    const calls = g.map(c => c.calls), costs = g.map(c => c.cost);
    console.log(`   ${o.padEnd(10)} ${String(g.length).padStart(4)} · קריאות ${median(calls)}/${(calls.reduce((a, b) => a + b, 0) / g.length).toFixed(1)} (p90 ${p(calls, 0.9)}, max ${Math.max(...calls)}) · ${usd(costs.reduce((a, b) => a + b, 0) / g.length)} = ${ag(costs.reduce((a, b) => a + b, 0) / g.length)} · הודעות לקוח ${median(g.map(c => c.userMsgs))}`);
  }
  const booked = by("booked");
  const bookedCost = booked.reduce((s, c) => s + c.cost, 0);
  console.log(`\n4) ★ עלות לקביעת תור: ממוצע שיחה שקבעה = ${usd(bookedCost / Math.max(1, booked.length))} = ${ag(bookedCost / Math.max(1, booked.length))} · כל ההוצאה חלקי כל הקביעות = ${usd(total / Math.max(1, booked.length))} = ${ag(total / Math.max(1, booked.length))}`);
  const warmBooked = booked.filter(c => c.cold === 0);
  if (warmBooked.length) console.log(`   קביעה בלי התחלה קרה (${warmBooked.length}): ${usd(warmBooked.reduce((s, c) => s + c.cost, 0) / warmBooked.length)} = ${ag(warmBooked.reduce((s, c) => s + c.cost, 0) / warmBooked.length)} · עם התחלה קרה (${booked.length - warmBooked.length}): ${usd((bookedCost - warmBooked.reduce((s, c) => s + c.cost, 0)) / Math.max(1, booked.length - warmBooked.length))}`);
  console.log(`   קריאות לקביעה: חציון ${median(booked.map(c => c.calls))}, ממוצע ${(booked.reduce((s, c) => s + c.calls, 0) / Math.max(1, booked.length)).toFixed(1)} · הודעות לקוח חציון ${median(booked.map(c => c.userMsgs))} · Sonnet ${pct(booked.reduce((s, c) => s + c.sonnetCalls, 0), booked.reduce((s, c) => s + c.calls, 0))} מהקריאות`);

  // tool usage inside booking conversations — where the calls go
  const toolCount = new Map<string, number>();
  for (const c of booked) for (const t of c.tools) toolCount.set(t, (toolCount.get(t) ?? 0) + 1);
  console.log(`   כלים בשיחות שקבעו (סה"כ קריאות-כלי / לקביעה): ${Array.from(toolCount.entries()).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n} (${(n / booked.length).toFixed(1)})`).join(" · ")}`);
  const errConvs = booked.filter(c => c.toolErrors > 0);
  console.log(`   קביעות עם שגיאת-כלי (מזהה שגוי וכד'): ${errConvs.length} (${pct(errConvs.length, booked.length)}) · קריאות ממוצע בהן ${(errConvs.reduce((s, c) => s + c.calls, 0) / Math.max(1, errConvs.length)).toFixed(1)} לעומת ${(booked.filter(c => !c.toolErrors).reduce((s, c) => s + c.calls, 0) / Math.max(1, booked.length - errConvs.length)).toFixed(1)} בלי`);

  const proactive = convs.filter(c => c.proactive);
  console.log(`\n5) שיחות שהתחילו מהודעה שלנו (נודניק/מעקב/סגירה): ${proactive.length} (${pct(proactive.length, convs.length)}) · עלות ${usd(proactive.reduce((s, c) => s + c.cost, 0))} (${pct(proactive.reduce((s, c) => s + c.cost, 0), total)}) · קבעו ${proactive.filter(c => c.outcome === "booked").length}`);
  const oneCall = convs.filter(c => c.calls === 1);
  console.log(`   שיחות של קריאה אחת (שאלה/תשובה): ${oneCall.length} (${pct(oneCall.length, convs.length)}) · עלות ${usd(oneCall.reduce((s, c) => s + c.cost, 0))} (${pct(oneCall.reduce((s, c) => s + c.cost, 0), total)})`);

  // first-message intents (rough keyword classes) — what could be code
  const cls = (t: string) => /^\s*(\d{1,2}(:\d{2})?|כן|לא|מאשר|סבבה|אוקיי|תודה|מעולה)\W*$/.test(t) ? "short-reply" : /לקבוע|תור|פנוי|אפשר ל|יש מקום|מתי יש/.test(t) ? "book" : /לבטל|ביטול/.test(t) ? "cancel" : /להזיז|להעביר|לשנות|לדחות/.test(t) ? "move" : /מחיר|כמה עולה|עולה/.test(t) ? "price" : /שעות|פתוח|סגור|כתובת|איפה/.test(t) ? "hours/address" : /מתי התור|התור שלי/.test(t) ? "my-appt" : "other";
  const intents = new Map<string, { n: number; cost: number }>();
  for (const c of convs) { const k = cls(c.firstUser); const v = intents.get(k) ?? { n: 0, cost: 0 }; v.n++; v.cost += c.cost; intents.set(k, v); }
  console.log(`\n6) הודעה ראשונה של הלקוח (סיווג גס): ${Array.from(intents.entries()).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${k} ${v.n} (${usd(v.cost)})`).join(" · ")}`);

  const expensive = [...convs].sort((a, b) => b.cost - a.cost).slice(0, 5);
  console.log(`\n7) 5 השיחות היקרות: ${expensive.map(c => `${usd(c.cost)}/${c.calls} קריאות/${c.outcome}/"${c.firstUser.slice(0, 30)}"`).join(" · ")}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
