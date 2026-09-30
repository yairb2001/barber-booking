/**
 * Local replay: run scripted customer turns through THIS checkout's agent code
 * (not the deployed one), in sandbox mode, against any business.
 *
 *   npx tsx --env-file=.env scripts/replay-local.ts --business shop-p9hh --scenarios scripts/replay-scenarios.json [--only new-booking,cancel] [--out /tmp/dir]
 *   npx tsx --env-file=.env scripts/replay-local.ts --business shop-p9hh --corpus-from dominant --n 20 --days 45 [--out /tmp/dir]
 *   --template   run the business on the compact template (as if its custom prompt were cleared), without touching the DB
 *   --demo       stage 1: send each turn to action "demo-turn" (the demo shop's tag → demo → pitch → sales routing)
 *   --dry        list the selected episodes and exit (no calls)
 *   --via-api    send the turns to production's POST /api/admin/agent/test (deployed code, production API key) instead of
 *                running the agent in this process; the owner session is minted locally from AUTH_SECRET (must match prod).
 *                env REPLAY_BASE overrides the host. --template maps to variant "template" there.
 *
 * Sandbox semantics are the ones of /api/admin/agent/test: mutating tools are
 * simulated, nothing is sent on WhatsApp, agent_usage rows are tagged
 * kind="sandbox", and every row keyed by the throw-away phone is deleted after
 * the run. --corpus-from replays the customer's own messages of real recent
 * conversations of another business (dominant) as a NEW customer of the target
 * business — the way a fresh shop on the template would meet them.
 *
 * Output: <out>/report.md (replies, tool calls, calls/cost per episode) + runs.json.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../src/lib/prisma";
import { runCustomerAgent, stablePromptParams, type SandboxOptions } from "../src/lib/agent/customer-agent";
import { buildBookingLink } from "../src/lib/link-first";
import { normalizeIsraeliPhone } from "../src/lib/messaging/phone";
import { signSession } from "../src/lib/auth";

const BASE = process.env.REPLAY_BASE ?? "https://barber-booking-indol.vercel.app";
async function apiTurn(session: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/admin/agent/test`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `admin_session=${session}` }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json as { replies: string[]; tools: { name: string; input: string | null; result: string }[]; toolLog: string[]; usage: { calls: number; costUsd: number }; ms: number };
}

type Scenario = { id: string; title: string; turns: string[] };
type Turn = { text: string; replies: string[]; tools: string[]; toolResults?: string[]; calls: number; costUsd: number; ms: number; error?: string };
const ACK_RE = /^(תודה|תודה רבה|סבבה|אחלה|מעולה|יאללה|ביי|נתראה|אוקי|אוקיי|בסדר|thanks|thank you|ty|ok|okay|cool|great)[\s!.👍🙏]*$/i;
type Run = { id: string; title: string; turns: Turn[]; calls: number; costUsd: number; flags: string[] };

const args: Record<string, string> = Object.fromEntries(process.argv.slice(2).map((a, i, arr): [string, string] | [] => a.startsWith("--") ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"] : []).filter((x): x is [string, string] => x.length === 2));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Throw-away phones: 97200 + 7 digits — no real Israeli mobile starts 9720.
let seq = Math.floor(Math.random() * 9000) + 1000;
const fakePhone = () => `97200${String(seq++).padStart(4, "0")}${String(Math.floor(Math.random() * 900) + 100)}`;

async function cleanup(businessId: string, phone: string) {
  const convs = await prisma.conversation.findMany({ where: { businessId, phone }, select: { id: true } });
  for (const c of convs) {
    await prisma.conversationMessage.deleteMany({ where: { conversationId: c.id } }).catch(() => {});
    await prisma.conversation.delete({ where: { id: c.id } }).catch(() => {});
  }
  await prisma.messageLog.deleteMany({ where: { businessId, customerPhone: phone } }).catch(() => {});
  await prisma.bookingProposal.deleteMany({ where: { businessId, phone } }).catch(() => {});
  const fake = await prisma.customer.findMany({ where: { businessId, phone: { in: [phone, phone.replace(/^972/, "0")] } }, select: { id: true } });
  for (const c of fake) {
    await prisma.appointment.deleteMany({ where: { customerId: c.id } }).catch(() => {});
    await prisma.waitlist.deleteMany({ where: { customerId: c.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: c.id } }).catch(() => {});
  }
}

async function corpusFrom(slug: string, n: number, days: number): Promise<Scenario[]> {
  const src = await prisma.business.findFirst({ where: { slug }, select: { id: true } });
  if (!src) throw new Error(`corpus business not found: ${slug}`);
  const since = new Date(Date.now() - days * 86400_000);
  const convs = await prisma.conversation.findMany({
    where: { businessId: src.id, agentType: { not: "owner" }, createdAt: { gte: since }, NOT: { phone: { startsWith: "9720" } } },
    orderBy: { createdAt: "desc" }, take: 400,
    select: { id: true, phone: true, whatsappName: true, messages: { orderBy: { createdAt: "asc" }, select: { role: true, content: true, source: true } } },
  });
  const out: Scenario[] = [];
  for (const c of convs) {
    const userTurns = c.messages.filter(m => m.role === "user").map(m => m.content.trim()).filter(t => t && !/^\[/.test(t));
    if (userTurns.length < 1 || userTurns.length > 8) continue;
    if (!/[a-zA-Z0-9א-ת]/.test(userTurns[0])) continue;
    if (c.messages.some(m => m.source === "admin")) continue; // manual threads don't replay cleanly
    out.push({ id: c.id.slice(0, 8), title: `${c.whatsappName ?? "?"} · ${userTurns.length} הודעות`, turns: userTurns });
    if (out.length >= n) break;
  }
  return out;
}

function flagsOf(run: Run): string[] {
  const f: string[] = [];
  for (const t of run.turns) {
    const txt = t.replies.join("\n");
    if (UUID.test(txt)) f.push("uuid leaked");
    if (/\*\*/.test(txt)) f.push("markdown");
    if (t.error) f.push(`error: ${t.error.slice(0, 80)}`);
    if (t.replies.length === 0 && !t.error && !ACK_RE.test(t.text.trim())) f.push(`silent turn: "${t.text.slice(0, 30)}"`);
  }
  return f;
}

async function main() {
  const slug = args.business; if (!slug) throw new Error("--business <slug>");
  const biz = await prisma.business.findFirst({ where: { slug }, select: { id: true, name: true, slug: true, businessType: true, settings: true } });
  if (!biz) throw new Error(`business not found: ${slug}`);
  // --template: the compact template body as promptOverride + promptVersion 4 —
  // the same prefix the business would get with systemPrompt = null.
  let templateBody: string | null = null;
  if (args.template) {
    const cfg = await prisma.agentConfig.findUnique({ where: { businessId: biz.id }, include: { faqs: true } });
    templateBody = stablePromptParams(biz, cfg ? { ...cfg, systemPrompt: null } : null, "", await buildBookingLink(biz)).defaultBody;
    console.log(`template mode: ${templateBody.length} chars`);
  }
  let scenarios: Scenario[] = args.scenarios ? JSON.parse(fs.readFileSync(args.scenarios, "utf8")) : await corpusFrom(args["corpus-from"] ?? "dominant", Number(args.n ?? 20), Number(args.days ?? 45));
  if (args.only) { const ids = args.only.split(","); scenarios = scenarios.filter(s => ids.includes(s.id)); }
  const viaApi = !!args["via-api"];
  const session = viaApi ? await signSession({ businessId: biz.id, role: "owner" }) : "";
  if (viaApi) console.log(`via API: ${BASE} (variant ${templateBody || args.template ? "template" : "live"})`);
  const out = args.out ?? `/tmp/claude-501/replay-${slug}-${Date.now()}`;
  fs.mkdirSync(out, { recursive: true });
  console.log(`${biz.name} (${biz.businessType}) · ${scenarios.length} episodes → ${out}`);
  if (args.dry) { for (const sc of scenarios) console.log(`  ${sc.id}  ${sc.title}\n    ${sc.turns.map(t => t.replace(/\n/g, " ").slice(0, 70)).join("\n    ")}`); return; }

  const runs: Run[] = [];
  for (const sc of scenarios) {
    const phone = viaApi ? `972000${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}` : normalizeIsraeliPhone(fakePhone());
    const run: Run = { id: sc.id, title: sc.title, turns: [], calls: 0, costUsd: 0, flags: [] };
    try {
      for (const text of sc.turns) {
        if (viaApi) {
          const t0 = Date.now();
          let turn: Turn;
          try {
            const r = args.demo
              ? await apiTurn(session, { action: "demo-turn", phone, text, senderName: sc.title.split(" · ")[0] }) as unknown as { replies: string[]; tools: { name: string; input: string | null; result: string }[]; toolLog: string[]; usage: { calls: number; costUsd: number }; ms: number; mode?: string; handled?: boolean }
              : await apiTurn(session, { action: "turn", phone, text, variant: args.template ? "template" : "live" });
            const modeTag = args.demo ? [`mode=${(r as { mode?: string }).mode ?? "—"}${(r as { handled?: boolean }).handled === false ? " (not handled)" : ""}`] : [];
            turn = { text, replies: r.replies ?? [], tools: [...(r.tools ?? []).map(t => t.name).filter(Boolean) as string[], ...(r.toolLog ?? [])], toolResults: [...modeTag, ...(r.tools ?? []).map(t => `${t.name}(${(t.input ?? "").slice(0, 90)}) → ${(t.result ?? "").replace(/\n/g, " ").slice(0, 140)}`), ...(r.toolLog ?? [])], calls: r.usage?.calls ?? 0, costUsd: r.usage?.costUsd ?? 0, ms: Date.now() - t0 };
          } catch (e) { turn = { text, replies: [], tools: [], calls: 0, costUsd: 0, ms: Date.now() - t0, error: String((e as Error).message ?? e) }; }
          run.turns.push(turn); run.calls += turn.calls; run.costUsd += turn.costUsd;
          await sleep(300);
          continue;
        }
        const sandbox: SandboxOptions = { replies: [], toolLog: [], usageKind: "sandbox", ...(templateBody ? { promptOverride: templateBody, promptVersion: 4 } : {}) };
        const started = new Date(); const t0 = Date.now();
        let error: string | undefined;
        try { await runCustomerAgent({ businessId: biz.id, phone, incomingText: text, sandbox }); }
        catch (e) { error = String((e as Error).message ?? e); }
        // Replies land in ConversationMessage (assistant rows written by the run).
        const conv = await prisma.conversation.findFirst({ where: { businessId: biz.id, phone }, orderBy: { createdAt: "desc" }, select: { id: true } });
        const rows = conv ? await prisma.conversationMessage.findMany({ where: { conversationId: conv.id, role: "assistant", createdAt: { gte: started } }, orderBy: { createdAt: "asc" }, select: { content: true } }) : [];
        const usage = conv ? await prisma.agentUsage.findMany({ where: { businessId: biz.id, conversationId: conv.id, createdAt: { gte: started } }, select: { costUsd: true } }) : [];
        const tools = conv ? (await prisma.conversationMessage.findMany({ where: { conversationId: conv.id, role: "tool", createdAt: { gte: started } }, select: { toolName: true } }).catch(() => [] as { toolName: string | null }[])).map(t => t.toolName ?? "?") : [];
        const turn: Turn = { text, replies: rows.map(r => r.content), tools: tools.length ? tools : sandbox.toolLog, calls: usage.length, costUsd: usage.reduce((s, u) => s + (u.costUsd ?? 0), 0), ms: Date.now() - t0, error };
        run.turns.push(turn); run.calls += turn.calls; run.costUsd += turn.costUsd;
        await sleep(300);
      }
    } finally {
      if (viaApi) await apiTurn(session, { action: "cleanup", phone }).catch(() => {});
      else await cleanup(biz.id, phone);
    }
    run.flags = flagsOf(run);
    runs.push(run);
    console.log(`  ${sc.id.padEnd(14)} ${String(run.calls).padStart(2)} calls  $${run.costUsd.toFixed(3)}  ${run.flags.length ? "⚑ " + run.flags.join("; ") : "ok"}`);
  }

  const totalCalls = runs.reduce((s, r) => s + r.calls, 0), totalCost = runs.reduce((s, r) => s + r.costUsd, 0);
  const md: string[] = [`# Replay · ${biz.name} (${biz.businessType}) · ${new Date().toISOString()}`, ``, `episodes: ${runs.length} · calls: ${totalCalls} · cost: $${totalCost.toFixed(3)} · flags: ${runs.filter(r => r.flags.length).length}`, ``];
  for (const r of runs) {
    md.push(`## ${r.id} — ${r.title}  (${r.calls} calls, $${r.costUsd.toFixed(3)})${r.flags.length ? `  ⚑ ${r.flags.join("; ")}` : ""}`);
    for (const t of r.turns) {
      md.push(`- **לקוח:** ${t.text.replace(/\n/g, " ")}`);
      if (t.toolResults?.length) for (const tr of t.toolResults) md.push(`  - 🔧 ${tr}`);
      else if (t.tools.length) md.push(`  - כלים: ${t.tools.join(", ")}`);
      for (const rep of t.replies) md.push(`  - **סוכן:** ${rep.replace(/\n/g, " ⏎ ")}`);
      if (!t.replies.length) md.push(`  - **סוכן:** (שקט)`);
      if (t.error) md.push(`  - ❌ ${t.error}`);
    }
    md.push("");
  }
  fs.writeFileSync(path.join(out, "report.md"), md.join("\n"));
  fs.writeFileSync(path.join(out, "runs.json"), JSON.stringify(runs, null, 2));
  console.log(`\ntotal: ${totalCalls} calls, $${totalCost.toFixed(3)} · report: ${path.join(out, "report.md")}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
