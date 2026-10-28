"use client";
/**
 * The wizard's check before "הפעל" (28.10.2026, spec "הקמה עצמית ליופי").
 * First what in the team and services would make the agent book wrong, each
 * with a way to fix it; each one stops "הפעל". Then a few test chats through the
 * real agent, which only show: a failure there is ours, and opens a task for us.
 */
import { useCallback, useEffect, useState } from "react";
import { C } from "./ui";

type Issue = { key: string; text: string; step: number; serviceId?: string };
type Chat = { title: string; ok: boolean; why: string; lines: { who: "customer" | "agent"; text: string }[] };

const getIssues = async (): Promise<Issue[]> => {
  const r = await fetch("/api/admin/onboarding/check").catch(() => null);
  const j = r?.ok ? await r.json().catch(() => null) : null;
  return Array.isArray(j?.issues) ? j.issues : [];
};

/** How many issues still stop "הפעל" (the activation screen asks before it activates). */
export const blockingIssues = async () => (await getIssues()).length;

export default function CheckStep({ onFix, onDone }: { onFix: (step: number) => void; onDone: () => void }) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [running, setRunning] = useState(false);

  const runChats = useCallback(async () => {
    setRunning(true); setChats(null);
    const r = await fetch("/api/admin/onboarding/check", { method: "POST" }).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    setChats(Array.isArray(j?.chats) ? j.chats : []);
    setRunning(false);
  }, []);

  const load = useCallback(async () => {
    const list = await getIssues();
    setIssues(list);
    if (!list.length) void runChats();
  }, [runChats]);
  useEffect(() => { void load(); }, [load]);

  const hide = async (serviceId: string) => {
    await fetch(`/api/admin/services/${serviceId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isVisible: false }) }).catch(() => null);
    void load();
  };

  if (!issues) return <p className="text-sm text-slate-500 py-4">בודקים…</p>;
  const blocked = issues.length > 0;
  return (
    <>
      <div className="space-y-2">
        {issues.length === 0 && <Row mark="ok" text="הצוות והשירותים תקינים: לכל שירות יש מי שעושה אותו, ולכל אחד יש שירות ויום עבודה." />}
        {issues.map(i => (
          <Row key={i.key} mark="no" text={i.text}>
            <button type="button" onClick={() => onFix(i.step)} className="text-[12px] font-bold rounded-lg border px-2 py-0.5" style={{ color: C.petrol, borderColor: C.petrol }}>לתקן</button>
            {i.serviceId && <button type="button" onClick={() => void hide(i.serviceId!)} className="text-[12px] text-slate-500 underline">להסתיר</button>}
          </Row>
        ))}
      </div>

      {!blocked && (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold" style={{ color: C.petrol }}>שיחות בדיקה עם הסוכן</p>
            {!running && chats && <button type="button" onClick={() => void runChats()} className="text-[12px] text-slate-500 underline">להריץ שוב</button>}
          </div>
          {running && <p className="text-sm text-slate-500 mt-2">הסוכן עונה ללקוחות מדומות, עד דקה…</p>}
          <div className="space-y-2 mt-2">
            {chats?.map(c => (
              <details key={c.title} className="rounded-xl border border-slate-200 px-3 py-2">
                <summary className="flex items-start gap-2 text-sm cursor-pointer list-none">
                  <Dot mark={c.ok ? "ok" : "warn"} />
                  <span className="min-w-0"><b className="font-semibold text-slate-800">{c.title}</b>{!c.ok && <span className="block text-[12px] text-amber-800">{c.why}. העברנו לצוות של צ׳אטור לבדיקה.</span>}</span>
                </summary>
                <div className="mt-2 space-y-1">
                  {c.lines.map((l, k) => <p key={k} className={`text-[13px] rounded-xl px-2.5 py-1.5 max-w-[90%] ${l.who === "customer" ? "bg-slate-100 text-slate-700" : "ms-auto text-white"}`} style={l.who === "agent" ? { background: C.petrol } : {}}>{l.text}</p>)}
                </div>
              </details>
            ))}
            {chats && !chats.length && <p className="text-[13px] text-slate-500">אין מספיק שירותים וצוות כדי לבנות שיחת בדיקה.</p>}
          </div>
        </div>
      )}

      {blocked && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mt-4">קודם לתקן את מה שמסומן באדום, ואז הסוכן ינסה שיחות כמו לקוחה.</p>}
      <button type="button" onClick={onDone} disabled={blocked || running} className="mt-6 w-full rounded-2xl py-3.5 text-[15px] font-bold text-white disabled:opacity-50" style={{ background: C.coral }}>המשך</button>
    </>
  );
}

function Dot({ mark }: { mark: "ok" | "no" | "warn" }) {
  const style = mark === "ok" ? { background: C.mist, color: "#0F8A63" } : mark === "no" ? { background: "#FDE8E4", color: "#C2410C" } : { background: "#FFF1D6", color: "#7A4A00" };
  return <span className="shrink-0 w-5 h-5 rounded-full text-[11px] font-bold inline-flex items-center justify-center mt-0.5" style={style}>{mark === "ok" ? "✓" : mark === "no" ? "!" : "?"}</span>;
}

function Row({ mark, text, children }: { mark: "ok" | "no" | "warn"; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
      <Dot mark={mark} />
      <span className="min-w-0 flex-1 text-slate-700">{text}</span>
      {children && <span className="shrink-0 flex items-center gap-2">{children}</span>}
    </div>
  );
}
