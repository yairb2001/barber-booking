/**
 * Test chats before "הפעל" (28.10.2026, spec "הקמה עצמית ליופי"): a few
 * customer messages built from this business's own team and services, run
 * through the real agent in sandbox mode (nothing is sent, nothing is saved),
 * and graded here in code, not by the agent: a reply about one service names
 * only people who do it, every person a tool was called with does that
 * service, a closed day gets no booking, and no reply has slashes ("את/ה")
 * or asterisks. They never stop "הפעל": with the
 * setup right, a failure is ours, so it opens a task for us.
 */
import { prisma } from "@/lib/prisma";
import { runCustomerAgent } from "@/lib/agent/customer-agent";
import { cleanupSandbox } from "@/lib/agent/sandbox-cleanup";
import { isServiceList } from "@/lib/agent/setup-fields";
import { getBusinessNow, addDaysISO, getDayOfWeekISO } from "@/lib/utils";

export type TestChat = { title: string; ok: boolean; why: string; lines: { who: "customer" | "agent"; text: string }[] };
type Scenario = { title: string; turns: string[]; serviceId?: string };

const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const SLASH = /(^|\s)(את\/ה|ה\/ית|\S+\/ת)(?=\s|$|[.,!?])/;

export async function runSetupTestChats(businessId: string): Promise<TestChat[]> {
  const [staff, services, cfg] = await Promise.all([
    prisma.staff.findMany({ where: { businessId, isAvailable: true }, select: { id: true, name: true, staffServices: { select: { serviceId: true } }, schedules: { where: { isWorking: true }, select: { dayOfWeek: true } } } }),
    prisma.service.findMany({ where: { businessId, isVisible: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, category: true } }),
    prisma.agentConfig.findUnique({ where: { businessId }, select: { setupConfig: true } }),
  ]);
  const doers = (serviceId: string) => staff.filter(s => s.staffServices.some(x => x.serviceId === serviceId));
  const openDays = new Set(staff.flatMap(s => s.schedules.map(d => d.dayOfWeek)));
  // A day two to seven days ahead that is open (not "מחר": after midnight the agent rightly asks which day).
  const today = getBusinessNow().date;
  const dayFor = (ids: string[]) => {
    const days = new Set(staff.filter(s => ids.includes(s.id)).flatMap(s => s.schedules.map(d => d.dayOfWeek)));
    const date = [2, 3, 4, 5, 6, 7].map(n => addDaysISO(today, n)).find(d => days.has(getDayOfWeekISO(d)));
    return date ? DAY[getDayOfWeekISO(date)] : null;
  };

  const scenarios: Scenario[] = [];
  // One booking per category (or the first service when there are none), on a day its people work.
  const cats = Array.from(new Set(services.map(s => s.category?.trim() || "")));
  for (const c of cats.slice(0, 4)) {
    const sv = services.find(s => (s.category?.trim() || "") === c && doers(s.id).length);
    const day = sv && dayFor(doers(sv.id).map(s => s.id));
    if (sv && day) scenarios.push({ title: `${sv.name} ביום ${day}`, turns: [`היי, אפשר ${sv.name} ביום ${day} בבוקר?`], serviceId: sv.id });
  }
  let setup: Record<string, unknown> = {};
  try { setup = cfg?.setupConfig ? JSON.parse(cfg.setupConfig) : {}; } catch { /* none */ }
  const VAGUE = "רוצה תור, בלי לומר מה";
  if (cats.filter(Boolean).length > 1 && isServiceList(setup.defaultService)) scenarios.push({ title: VAGUE, turns: ["היי, רוצה לקבוע תור"] });
  const women = services.find(s => /נשים/.test(s.name)), men = services.find(s => /גברים/.test(s.name));
  if (women && men) scenarios.push({ title: "אני צריכה תספורת", turns: ["אני צריכה תספורת בשבוע הבא"] });
  const closed = DAY.findIndex((_, i) => !openDays.has(i));
  if (closed >= 0 && openDays.size) scenarios.push({ title: `יום ${DAY[closed]}, כשסגור`, turns: [`יש מקום ביום ${DAY[closed]}?`] });

  const name = new Map(staff.map(s => [s.id, s.name]));
  const svcName = new Map(services.map(s => [s.id, s.name]));
  const results = await Promise.all(scenarios.map(async (sc, i): Promise<TestChat> => {
    const phone = `972000${String(Date.now() + i).slice(-7)}`;
    const lines: TestChat["lines"] = [];
    let tools: { toolName: string | null; toolInput: string | null }[] = [];
    try {
      for (const text of sc.turns) {
        lines.push({ who: "customer", text });
        const sandbox = { replies: [] as string[], toolLog: [] as string[], usageKind: "sandbox" };
        await runCustomerAgent({ businessId, phone, incomingText: text, sandbox });
        for (const r of sandbox.replies) lines.push({ who: "agent", text: r });
      }
      // Every tool the agent called (the sandbox log keeps only the ones that would change something).
      const conv = await prisma.conversation.findFirst({ where: { businessId, phone }, select: { id: true } });
      if (conv) tools = await prisma.conversationMessage.findMany({ where: { conversationId: conv.id, role: "tool" }, select: { toolName: true, toolInput: true } });
    } catch (e) {
      console.error("[setup-test-chats]", sc.title, e);
      return { title: sc.title, ok: false, why: "הסוכן לא ענה", lines };
    } finally {
      await cleanupSandbox(businessId, phone);
    }
    const why = grade(tools, lines, { doers, name, svcName, openDays, serviceId: sc.serviceId, women: sc.title === "אני צריכה תספורת" ? women?.id : undefined, vague: sc.title === VAGUE });
    return { title: sc.title, ok: !why, why: why ?? "", lines };
  }));

  const failed = results.filter(r => !r.ok);
  const TASK = "שיחת בדיקה לפני הפעלה נכשלה";
  // One open task per business, not one per run of the check.
  if (failed.length && !(await prisma.crmTask.count({ where: { businessId, doneAt: null, title: { startsWith: TASK } } }))) {
    const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } });
    await prisma.crmTask.create({ data: { title: `${TASK} אצל ${biz?.name ?? "עסק"}: ${failed.map(f => `${f.title} (${f.why})`).join("; ").slice(0, 300)}`, businessId, dueAt: new Date() } }).catch(() => {});
  }
  return results;
}

type Ctx = { doers: (serviceId: string) => { id: string }[]; name: Map<string, string>; svcName: Map<string, string>; openDays: Set<number>; serviceId?: string; women?: string; vague?: boolean };

/** What went wrong in one chat, in plain words, or null when it is fine. */
function grade(tools: { toolName: string | null; toolInput: string | null }[], lines: TestChat["lines"], c: Ctx): string | null {
  const said = lines.filter(l => l.who === "agent").map(l => l.text).join("\n");
  // A reply about one service names only who does it ("אצל דני", "לדני").
  if (c.serviceId) {
    const ok = new Set(c.doers(c.serviceId).map(s => s.id));
    for (const [id, n] of Array.from(c.name)) {
      if (!ok.has(id) && new RegExp(`(^|[^א-ת])[בלשו]?${n.trim().split(/\s+/)[0]}(?![א-ת])`).test(said)) return `הוצע ${c.svcName.get(c.serviceId) ?? "שירות"} אצל ${n}, שלא עושה אותו`;
    }
  }
  for (const tool of tools) {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(tool.toolInput ?? "{}"); } catch { continue; }
    const tn = tool.toolName ?? "";
    // The service and person of the call, and of each further treatment of a visit.
    const parts = [input, ...(["treatments", "others"] as const).flatMap(k => (Array.isArray(input[k]) ? (input[k] as Record<string, unknown>[]) : []))];
    for (const p of parts) {
      const serviceId = typeof p.serviceId === "string" ? p.serviceId : null, staffId = typeof p.staffId === "string" ? p.staffId : null;
      if (serviceId && staffId && !c.doers(serviceId).some(s => s.id === staffId)) return `הוצע ${c.svcName.get(serviceId) ?? "שירות"} אצל ${c.name.get(staffId) ?? "מישהו"}, שלא עושה אותו`;
      if (c.women && serviceId && tn === "propose_booking" && serviceId !== c.women && /תספורת/.test(c.svcName.get(serviceId) ?? "")) return "נקבעה תספורת שאינה תספורת נשים";
    }
    if (tn === "propose_booking" && typeof input.date === "string" && !c.openDays.has(getDayOfWeekISO(input.date))) return "הוצע תור ביום שהעסק סגור";
  }
  for (const l of lines.filter(x => x.who === "agent")) {
    if (SLASH.test(l.text)) return "יש לוכסן בפנייה (כמו את/ה)";
    if (l.text.includes("**")) return "יש כוכביות בתשובה";
  }
  if (!lines.some(l => l.who === "agent")) return "הסוכן לא ענה";
  if (c.vague && said.split("₪").length > 2) return "הוצגה רשימת מחירים במקום שאלה לפי תחום";
  return null;
}
