// QA sensor for the DOMINANT booking agent.
//
// Reads recent WhatsApp conversations and flags the failure patterns we have
// concrete evidence for. Pure detection — no LLM, no tokens. Meant to run daily
// (on the subscription, via a scheduled Claude Code routine) so the agent that
// reviews it starts from precise, deterministic signals instead of eyeballing
// every chat.
//
//   node --env-file=.env scripts/qa-review.mjs [days]   (default: 2)
//
// Output: a Hebrew report to stdout + machine-readable JSON at /tmp/qa-report.json
import { PrismaClient } from "@prisma/client";
import fs from "fs";

const prisma = new PrismaClient();
const DAYS = Number(process.argv[2] || 2);
const BIZ = "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2"; // DOMINANT

const il = (d) => d ? new Date(d).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", hour12: false }) : "-";
const ilTimeMin = (d) => { // minutes-of-day in Israel tz
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const h = Number(p.find(x => x.type === "hour").value), m = Number(p.find(x => x.type === "minute").value);
  return h * 60 + m;
};
const ilDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const hm = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const norm = (p) => p.startsWith("972") ? p : p.startsWith("0") ? "972" + p.slice(1) : p;
const local = (p) => p.replace(/^972/, "0");

const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
const findings = [];
const add = (f) => findings.push(f);

const convos = await prisma.conversation.findMany({
  where: { businessId: BIZ, agentType: "customer", lastMessageAt: { gte: since } },
  select: { id: true, phone: true, whatsappName: true, escalatedAt: true, lastMessageAt: true },
  orderBy: { lastMessageAt: "desc" },
});

const CONFIRM = /קבעתי לך|קבעתי אצל|רשמתי לך תור|התור שלך נקבע|נקבע בהצלחה|קבענו לך/;
const label = (c) => `${c.whatsappName || "—"} (${c.phone}) [${c.id.slice(0, 8)}]`;

// exclude the owner's own test conversations (matches the module)
const ownerBiz = await prisma.business.findUnique({ where:{ id:BIZ }, select:{ settings:true } });
let ownerPhone = null;
try { const st = ownerBiz?.settings ? JSON.parse(ownerBiz.settings) : {}; if (st.ownerLoginPhone) ownerPhone = norm(st.ownerLoginPhone); } catch {}

for (const c of convos) {
  if (ownerPhone && norm(c.phone) === ownerPhone) continue;
  try {
    const msgs = await prisma.conversationMessage.findMany({
      where: { conversationId: c.id },
      orderBy: { createdAt: "asc" },
      select: { role: true, source: true, content: true, toolName: true, toolInput: true, createdAt: true },
    });
    if (!msgs.length) continue;

    const asst = msgs.filter(m => m.role === "assistant" && m.source !== "admin");
    const tools = msgs.filter(m => m.role === "tool");
    const bookOk = tools.some(t => t.toolName === "book_appointment" && /✅|נקבע בהצלחה/.test(t.content));

    // ── D1: phantom booking — agent said "I booked" but no successful book_appointment ran
    const confirmMsg = asst.find(m => CONFIRM.test(m.content));
    if (confirmMsg && !bookOk) {
      add({ sev: "🔴", type: "תור-רפאים", conv: label(c), cid: c.id,
        evidence: `הסוכן כתב "${confirmMsg.content.slice(0, 80)}" אך לא רץ book_appointment מוצלח בשיחה`,
        klass: "code/prompt", fix: "לוודא שהמודל החזק מטפל בכל שלב קביעה + לא לאשר בלי ✅ מהכלי" });
    }

    // ── D3: false "no availability" — empty get_available_slots for a date that returned slots elsewhere
    const slotCalls = tools.filter(t => t.toolName === "get_available_slots" || t.toolName === "find_next_available");
    const byDate = new Map();
    for (const t of slotCalls) {
      const m = t.content.match(/(\d{4}-\d{2}-\d{2})/);
      if (!m) continue;
      let staff = "__unknown__", hasInput = false;
      if (t.toolInput) { try { staff = JSON.parse(t.toolInput).staffId ?? "__any__"; hasInput = true; } catch {} }
      const rec = byDate.get(m[1]) || { empty: new Set(), full: new Set(), missingInput: false };
      if (/אין תורים פנויים/.test(t.content)) rec.empty.add(staff); else rec.full.add(staff);
      if (!hasInput) rec.missingInput = true;
      byDate.set(m[1], rec);
    }
    for (const [d, r] of byDate) {
      const sameBarber = [...r.empty].some(s => s !== "__unknown__" && r.full.has(s));
      if (sameBarber) {
        add({ sev: "🟠", type: "אין-מקום כוזב", conv: label(c), cid: c.id,
          evidence: `לתאריך ${d} אותו ספר החזיר גם ריק וגם שעות — glitch מאומת`,
          klass: "code", fix: "glitch אמיתי (Neon?) — ניסיון חוזר לא מספיק כי נמשך דקות" });
      } else if (r.empty.size && r.full.size && r.missingInput) {
        add({ sev: "🟠", type: "אין-מקום כוזב (לבדוק)", conv: label(c), cid: c.id,
          evidence: `לתאריך ${d} ריק מול מלא (קלט-הכלי לא נשמר) — לבדוק ידנית`,
          klass: "code", fix: "מעכשיו קלט-הכלי נשמר → יאובחן ודאית בפעם הבאה" });
      }
    }

    // ── D2: ghost "no appointment" — check_appointment said none, but customer had one
    for (const t of tools.filter(t => t.toolName === "check_appointment" && /לא נמצאו תורים/.test(t.content))) {
      const cust = await prisma.customer.findFirst({ where: { businessId: BIZ, OR: [{ phone: norm(c.phone) }, { phone: local(c.phone) }] }, select: { id: true } });
      if (!cust) continue;
      const appt = await prisma.appointment.findFirst({
        where: { customerId: cust.id, businessId: BIZ, status: { in: ["confirmed", "pending"] },
          date: { gte: new Date(`${ilDate(t.createdAt)}T00:00:00.000Z`) } },
        select: { date: true, startTime: true },
      });
      if (appt) {
        add({ sev: "🔴", type: "תור-קיים לא נמצא", conv: label(c), cid: c.id,
          evidence: `check_appointment החזיר "לא נמצאו תורים" ב-${il(t.createdAt)}, אך ללקוח יש תור ${ilDate(appt.date)} ${appt.startTime}`,
          klass: "code", fix: "סינון date>=תחילת היום העסקי (כבר תוקן) — לנטר" });
        break;
      }
    }

    // ── D4: past-time appointment presented as upcoming
    for (const m of asst) {
      const mt = m.content.match(/תור.{0,20}?(\d{1,2}:\d{2})/);
      if (mt && /היום/.test(m.content)) {
        const apptMin = hm(mt[1]);
        if (apptMin < ilTimeMin(m.createdAt) - 5) {
          add({ sev: "🟠", type: "תור-שעבר כעתידי", conv: label(c), cid: c.id,
            evidence: `ב-${il(m.createdAt)} הסוכן אמר "יש לך תור היום ${mt[1]}" — אך השעה כבר עברה`,
            klass: "code", fix: "סינון תורים של היום שעברו מהקונטקסט (כבר תוקן) — לנטר" });
          break;
        }
      }
    }

    // ── D5: customer left unanswered — newest message is the customer's, agent not muted
    const last = msgs[msgs.length - 1];
    const ageMin = (Date.now() - new Date(last.createdAt).getTime()) / 60000;
    if (last.role === "user" && !c.escalatedAt && ageMin > 20 && ageMin < DAYS * 24 * 60) {
      add({ sev: "🟡", type: "לקוח-לא-נענה", conv: label(c), cid: c.id,
        evidence: `ההודעה האחרונה היא של הלקוח (${il(last.createdAt)}) ואין תגובת סוכן, השיחה לא הוסלמה`,
        klass: "code/ops", fix: "לבדוק אם ה-webhook/סוכן נכשל בתור הזה" });
    }
  } catch (e) {
    console.error("convo error", c.id, e.message);
  }
}

// ── Report ──
const order = { "🔴": 0, "🟠": 1, "🟡": 2 };
findings.sort((a, b) => order[a.sev] - order[b.sev]);
console.log(`\n📋 דוח QA — סוכן התורים DOMINANT`);
console.log(`חלון: ${DAYS} ימים אחרונים (מ-${il(since)})`);
console.log(`שיחות שנבדקו: ${convos.length} | ממצאים: ${findings.length}`);
console.log("─".repeat(60));
if (!findings.length) console.log("✅ לא נמצאו תקלות בחלון הזה.");
for (const f of findings) {
  console.log(`\n${f.sev} ${f.type}  —  ${f.conv}`);
  console.log(`   מה קרה: ${f.evidence}`);
  console.log(`   סוג תיקון: ${f.klass}`);
  console.log(`   כיוון: ${f.fix}`);
}
console.log("\n" + "─".repeat(60));
const counts = findings.reduce((a, f) => (a[f.type] = (a[f.type] || 0) + 1, a), {});
console.log("סיכום:", JSON.stringify(counts, null, 0));
fs.writeFileSync("/tmp/qa-report.json", JSON.stringify({ window: { days: DAYS, since }, checked: convos.length, findings }, null, 2));
console.log("JSON נשמר ב-/tmp/qa-report.json");

// --save: mirror findings into the /admin/qa panel (deduped), same as the cron does.
if (process.argv.includes("--save")) {
  const sevMap = { "🔴": "high", "🟠": "medium", "🟡": "low" };
  const dedupSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  let created = 0;
  for (const fnd of findings) {
    if (!fnd.cid) continue;
    const exists = await prisma.qaSuggestion.findFirst({
      where: { businessId: BIZ, conversationId: fnd.cid, type: fnd.type, createdAt: { gte: dedupSince } },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.qaSuggestion.create({ data: {
      businessId: BIZ,
      type: fnd.type.replace(/ \(לבדוק\)$/, ""),
      klass: fnd.klass.split("/")[0],
      severity: sevMap[fnd.sev] || "medium",
      title: fnd.evidence,
      detail: `${fnd.conv}${/מאומת/.test(fnd.evidence) ? " · מאומת" : " · לבדוק"}`,
      conversationId: fnd.cid,
      proposedFix: null,
    }});
    created++;
  }
  console.log(`--save: נוצרו ${created} כרטיסים חדשים בפאנל (dedup דילג על השאר)`);
}
await prisma.$disconnect();
