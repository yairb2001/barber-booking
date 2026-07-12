/**
 * QA detectors for the booking agent.
 *
 * Pure, deterministic detection over recent conversations — no LLM, no tokens.
 * Flags the failure patterns we have concrete evidence for. The findings are
 * CANDIDATES: a human (or a Claude Code review pass) verifies before acting, so
 * detectors err toward recall but each carries a confidence and the evidence.
 */
import { prisma } from "@/lib/prisma";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { getBusinessNow } from "@/lib/utils";

export type QaFinding = {
  severity: "high" | "medium" | "low";
  type: string;
  conversationId: string;
  who: string;
  evidence: string;
  klass: "code" | "prompt" | "data" | "ops";
  confidence: "confirmed" | "likely";
};

const CONFIRM = /קבעתי לך|קבעתי אצל|רשמתי לך תור|התור שלך נקבע|נקבע בהצלחה|קבענו לך/;

function ilDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function ilTimeMin(d: Date): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  return Number(p.find(x => x.type === "hour")!.value) * 60 + Number(p.find(x => x.type === "minute")!.value);
}
const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

export async function runQaDetectors(businessId: string, sinceDays = 1): Promise<QaFinding[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const findings: QaFinding[] = [];

  const convos = await prisma.conversation.findMany({
    where: { businessId, agentType: "customer", lastMessageAt: { gte: since } },
    select: { id: true, phone: true, whatsappName: true, escalatedAt: true },
    orderBy: { lastMessageAt: "desc" },
  });

  for (const c of convos) {
    const who = `${c.whatsappName || "—"} (${c.phone})`;
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

      // D1 — phantom booking: agent claimed a booking, no successful book_appointment ran
      const confirmMsg = asst.find(m => CONFIRM.test(m.content));
      if (confirmMsg && !bookOk) {
        findings.push({ severity: "high", type: "תור-רפאים", conversationId: c.id, who,
          evidence: `הסוכן כתב "${confirmMsg.content.slice(0, 70)}" בלי book_appointment מוצלח`,
          klass: "prompt", confidence: "confirmed" });
      }

      // D3 — false "no availability": same DATE returned both empty AND slots, and the
      // non-empty results all name a SINGLE barber (so it's the same barber-specific
      // query flaking, not just a different barber being full). Multi-barber → skip
      // (that's the false positive we saw with אורי אנג'ל).
      const slotCalls = tools.filter(t => t.toolName === "get_available_slots" || t.toolName === "find_next_available");
      // Group by date, tracking WHICH barber each empty/full result was for (from
      // the stored tool input). Same barber empty+full on one date = a real glitch
      // (confirmed). Different barbers = one full, one busy — not a glitch. When the
      // input wasn't recorded (older messages) we can't tell → "verify".
      const byDate = new Map<string, { empty: Set<string>; full: Set<string>; missingInput: boolean }>();
      for (const t of slotCalls) {
        const dm = t.content.match(/(\d{4}-\d{2}-\d{2})/);
        if (!dm) continue;
        let staff = "__unknown__", hasInput = false;
        if (t.toolInput) { try { staff = (JSON.parse(t.toolInput).staffId as string) ?? "__any__"; hasInput = true; } catch { /* ignore */ } }
        const rec = byDate.get(dm[1]) || { empty: new Set<string>(), full: new Set<string>(), missingInput: false };
        if (/אין תורים פנויים/.test(t.content)) rec.empty.add(staff); else rec.full.add(staff);
        if (!hasInput) rec.missingInput = true;
        byDate.set(dm[1], rec);
      }
      for (const [d, r] of Array.from(byDate.entries())) {
        const sameBarber = Array.from(r.empty).some(s => s !== "__unknown__" && r.full.has(s));
        if (sameBarber) {
          findings.push({ severity: "medium", type: "אין-מקום כוזב", conversationId: c.id, who,
            evidence: `לתאריך ${d} אותו ספר החזיר גם "אין תורים פנויים" וגם שעות — glitch מאומת`,
            klass: "code", confidence: "confirmed" });
        } else if (r.empty.size && r.full.size && r.missingInput) {
          findings.push({ severity: "medium", type: "אין-מקום כוזב", conversationId: c.id, who,
            evidence: `לתאריך ${d} התקבל גם ריק וגם שעות (קלט-הכלי לא נשמר — לבדוק ידנית)`,
            klass: "code", confidence: "likely" });
        }
        // else: empty & full for DIFFERENT known barbers → not a glitch, skip.
      }

      // D2 — ghost "no appointment": check_appointment said none, but the customer had one
      for (const t of tools.filter(t => t.toolName === "check_appointment" && /לא נמצאו תורים/.test(t.content))) {
        const phone = normalizeIsraeliPhone(c.phone), localPhone = phone.replace(/^972/, "0");
        const cust = await prisma.customer.findFirst({ where: { businessId, OR: [{ phone }, { phone: localPhone }] }, select: { id: true } });
        if (!cust) continue;
        const appt = await prisma.appointment.findFirst({
          where: { customerId: cust.id, businessId, status: { in: ["confirmed", "pending"] }, date: { gte: new Date(`${ilDate(t.createdAt)}T00:00:00.000Z`) } },
          select: { date: true, startTime: true },
        });
        if (appt) {
          findings.push({ severity: "high", type: "תור-קיים לא נמצא", conversationId: c.id, who,
            evidence: `check_appointment החזיר "לא נמצאו תורים" אך ללקוח יש תור ${ilDate(appt.date)} ${appt.startTime}`,
            klass: "code", confidence: "confirmed" });
          break;
        }
      }

      // D4 — a passed same-day appointment presented as upcoming
      for (const m of asst) {
        const mt = m.content.match(/תור.{0,20}?(\d{1,2}:\d{2})/);
        if (mt && /היום/.test(m.content) && hm(mt[1]) < ilTimeMin(m.createdAt) - 5) {
          findings.push({ severity: "medium", type: "תור-שעבר כעתידי", conversationId: c.id, who,
            evidence: `הסוכן אמר "יש לך תור היום ${mt[1]}" אחרי שהשעה כבר עברה`, klass: "code", confidence: "likely" });
          break;
        }
      }

      // D5 — customer left unanswered: newest message is the customer's, agent not muted
      const last = msgs[msgs.length - 1];
      const ageMin = (Date.now() - new Date(last.createdAt).getTime()) / 60000;
      if (last.role === "user" && !c.escalatedAt && ageMin > 30 && ageMin < sinceDays * 24 * 60) {
        findings.push({ severity: "low", type: "לקוח-לא-נענה", conversationId: c.id, who,
          evidence: `ההודעה האחרונה היא של הלקוח ואין תגובת סוכן (${Math.round(ageMin)} דק'), השיחה לא הוסלמה`,
          klass: "ops", confidence: "likely" });
      }
    } catch (e) {
      console.error("[qa] convo error", c.id, e);
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return findings;
}

/** One-line-per-finding Hebrew digest for a WhatsApp nudge to the owner. */
export function formatDigest(findings: QaFinding[]): string {
  if (!findings.length) return "בדיקת ה-QA היומית: לא נמצאו בעיות בשיחות אתמול ✅";
  const emoji = { high: "🔴", medium: "🟠", low: "🟡" } as const;
  const lines = findings.slice(0, 10).map(f => `${emoji[f.severity]} ${f.type} — ${f.who}`);
  const more = findings.length > 10 ? `\n(ועוד ${findings.length - 10})` : "";
  return `בדיקת QA יומית — נמצאו ${findings.length} דברים לבדיקה:\n\n${lines.join("\n")}${more}\n\nלפירוט ולתיקון — פתח את קלוד קוד.`;
}
