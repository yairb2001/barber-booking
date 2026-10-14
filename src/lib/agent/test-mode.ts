/**
 * Test mode: a shop that hasn't pressed "הפעל" yet (14.10.2026, Yair: "יש אנשים
 * שירצו רק לתת את ההגדרות הראשוניות... לבדוק לאט לאט, ואז נגיד בתחילת החודש
 * ללחוץ על הפעל").
 *
 * Until then the agent answers only the numbers the owner set as testers
 * (settings.agentTesters), for real on WhatsApp but as a sandbox run: bookings,
 * cancellations and the like are simulated, nothing lands in the calendar.
 * Every message still counts against the free package (free-package.ts).
 * Anyone else who writes waits for a person, with no automatic reply.
 */
import { runCustomerAgent, type SandboxOptions } from "@/lib/agent/customer-agent";
import { sendMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

/** Said after a test turn that "did" something, so nobody looks for it in the calendar. */
const TEST_NOTE = "(בדיקה: שום דבר לא נשמר ביומן. אחרי הפעלת המערכת זה יהיה אמיתי.)";

export function testerPhones(settings: string | null | undefined): string[] {
  try {
    const s = settings ? JSON.parse(settings) : {};
    if (!Array.isArray(s.agentTesters)) return [];
    return s.agentTesters.filter((x: unknown): x is string => typeof x === "string" && !!x.trim()).map((x: string) => normalizeIsraeliPhone(x)).filter(Boolean);
  } catch { return []; }
}

export const isTester = (settings: string | null | undefined, phone: string) => testerPhones(settings).includes(normalizeIsraeliPhone(phone));

/** One test turn: the agent runs as in the sandbox, its replies go out on WhatsApp. */
export async function runTesterTurn(o: { businessId: string; phone: string; text: string }): Promise<void> {
  const sandbox: SandboxOptions = { replies: [], toolLog: [], usageKind: "tester", enforceBudget: true };
  await runCustomerAgent({ businessId: o.businessId, phone: o.phone, incomingText: o.text, alreadyPersisted: true, sandbox });
  const out = sandbox.toolLog.length ? [...sandbox.replies, TEST_NOTE] : sandbox.replies;
  for (let i = 0; i < out.length; i++) {
    await sendMessage({ businessId: o.businessId, customerPhone: o.phone, kind: "agent_reply", body: out[i] });
    if (i < out.length - 1) await new Promise(r => setTimeout(r, 700));
  }
}
