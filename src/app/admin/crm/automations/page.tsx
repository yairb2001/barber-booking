"use client";

import { useEffect, useState } from "react";
import { C, Btn, PageHead, useCrm, crmAction } from "../ui";

type Step = { delayMinutes?: number; beforeCallMinutes?: number; text: string };
type Auto = { id: string; key: string; name: string; trigger: string; enabled: boolean; audience: string; steps: Step[]; stopOn: string[]; stats: { started: number; active: number; replied: number } };
type Data = { variables: string[]; stopLabels: Record<string, string>; automations: Auto[] };

/** delayMinutes ↔ a value + unit the editor shows. */
function toUnit(min: number): { n: number; unit: "min" | "hour" | "day" } {
  if (min && min % 1440 === 0) return { n: min / 1440, unit: "day" };
  if (min && min % 60 === 0) return { n: min / 60, unit: "hour" };
  return { n: min, unit: "min" };
}
const UNIT_MIN = { min: 1, hour: 60, day: 1440 } as const;

export default function AutomationsPage() {
  const { data, error, reload } = useCrm<Data>("view=automations");
  const [sel, setSel] = useState<string>("");
  const [draft, setDraft] = useState<Step[] | null>(null);
  const [focus, setFocus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<number, string>>({});

  useEffect(() => { if (data && !sel) setSel(data.automations[0]?.id ?? ""); }, [data, sel]);
  const a = data?.automations.find(x => x.id === sel) ?? null;
  useEffect(() => { setDraft(a ? a.steps.map(s => ({ ...s })) : null); setPreview({}); setFocus(0); }, [a]);
  const dirty = !!a && !!draft && JSON.stringify(a.steps) !== JSON.stringify(draft);

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true); setFlash(null);
    const r = await crmAction(body);
    setBusy(false); setFlash(r.ok ? done : r.error ?? "שגיאה");
    if (r.ok) await reload();
  }
  function insertVar(v: string) {
    setDraft(d => (d ?? []).map((s, i) => (i === focus ? { ...s, text: `${s.text}${s.text.endsWith(" ") || !s.text ? "" : " "}${v}` } : s)));
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>טוען…</p>;

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="אוטומציות" sub="כל ההודעות יוצאות מהמספר של צ׳אטור · לא בשבת ולא בין 21:30 ל-08:00 · כל אוטומציה כבויה עד שתדליק אותה" />
      {flash && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: C.mist, color: C.petrol }}>{flash}</p>}
      <div className="flex flex-wrap gap-4 items-start">
        <section aria-label="רשימת האוטומציות" className="flex-[1_1_300px] min-w-0 flex flex-col gap-2.5">
          {data.automations.map(x => (
            <button key={x.id} type="button" onClick={() => setSel(x.id)} className="text-right bg-white rounded-[14px] px-4 py-3.5 flex flex-col gap-1.5" style={{ border: x.id === sel ? `2px solid ${C.petrol}` : `1px solid ${C.line}` }}>
              <span className="flex justify-between items-center gap-2 w-full">
                <span className="font-bold text-[15px]">{x.name}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={x.enabled ? { background: "#E3F7EF", color: "#0F6B4F" } : { background: C.soft, color: C.muted }}>{x.enabled ? "פעילה" : "כבויה"}</span>
              </span>
              <span className="text-xs" style={{ color: C.muted }}>כש: {x.trigger}{x.audience === "rep" ? " · הודעה לנציג, לא לליד" : ""}</span>
              <span className="text-xs" style={{ color: "#3E5A5B" }}>החודש: {x.stats.started} התחילו · {x.stats.active} רצות עכשיו{x.audience === "lead" ? ` · ${x.stats.replied} ענו או קבעו` : ""}</span>
            </button>
          ))}
        </section>

        {a && draft && (
          <section aria-label="עריכת אוטומציה" className="flex-[999_1_520px] min-w-0 bg-white rounded-[18px] p-5 flex flex-col gap-4" style={{ border: `1px solid ${C.line}` }}>
            <div className="flex flex-wrap justify-between items-center gap-2.5">
              <div>
                <h2 className="m-0 text-[19px] font-extrabold">{a.name}</h2>
                <span className="text-[13px]" style={{ color: C.muted }}>מופעלת כש: {a.trigger}</span>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold min-h-[44px]">
                <input type="checkbox" checked={a.enabled} disabled={busy} onChange={e => save({ action: "automation.update", id: a.id, enabled: e.target.checked }, e.target.checked ? "האוטומציה פעילה מעכשיו" : "האוטומציה כובתה")} className="w-5 h-5" style={{ accentColor: C.petrol }} />פעילה
              </label>
            </div>

            <ol className="list-none m-0 p-0 flex flex-col">
              {draft.map((s, i) => {
                const rel = s.beforeCallMinutes != null;
                const u = toUnit(rel ? s.beforeCallMinutes! : s.delayMinutes ?? 0);
                return (
                  <li key={i} className="flex gap-3.5">
                    <div className="flex flex-col items-center w-[30px] shrink-0">
                      <span className="w-[30px] h-[30px] rounded-full inline-flex items-center justify-center text-xs font-bold" style={{ background: C.petrol, color: "#fff" }}>{i + 1}</span>
                      <span className="flex-1 w-0.5 min-h-[16px]" style={{ background: C.line }} />
                    </div>
                    <div className="flex-1 min-w-0 pb-4 flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-[13px] font-bold" style={{ color: C.petrol }}>
                        <span>{rel ? "לפני השיחה:" : i === 0 ? "אחרי הטריגר:" : "אחרי ההודעה הקודמת:"}</span>
                        <input type="number" min={0} value={u.n} onChange={e => { const n = Math.max(0, Number(e.target.value) || 0); setDraft(d => (d ?? []).map((x, j) => j === i ? (rel ? { text: x.text, beforeCallMinutes: n * UNIT_MIN[u.unit] } : { text: x.text, delayMinutes: n * UNIT_MIN[u.unit] }) : x)); }} className="w-16 h-9 rounded-lg px-2 text-sm font-normal" style={{ border: "1px solid #C7D8D5" }} aria-label="כמה זמן" />
                        <select value={u.unit} onChange={e => { const unit = e.target.value as keyof typeof UNIT_MIN; setDraft(d => (d ?? []).map((x, j) => j === i ? (rel ? { text: x.text, beforeCallMinutes: u.n * UNIT_MIN[unit] } : { text: x.text, delayMinutes: u.n * UNIT_MIN[unit] }) : x)); }} className="h-9 rounded-lg px-2 text-sm font-normal" style={{ border: "1px solid #C7D8D5" }} aria-label="יחידה">
                          <option value="min">דקות</option><option value="hour">שעות</option><option value="day">ימים</option>
                        </select>
                        {!rel && u.n === 0 && <span className="font-normal" style={{ color: C.muted }}>(מיד)</span>}
                        {draft.length > 1 && <button type="button" onClick={() => setDraft(d => (d ?? []).filter((_, j) => j !== i))} className="ms-auto text-xs font-semibold min-h-[32px]" style={{ color: "#B42318" }}>מחק הודעה</button>}
                      </div>
                      <label className="sr-only" htmlFor={`step-${i}`}>נוסח הודעה {i + 1}</label>
                      <textarea id={`step-${i}`} value={s.text} onFocus={() => setFocus(i)} onChange={e => setDraft(d => (d ?? []).map((x, j) => j === i ? { ...x, text: e.target.value } : x))} rows={3} className="w-full rounded-[14px] px-3 py-2.5 text-sm leading-relaxed resize-y" style={{ background: "#D9FDD3", border: focus === i ? `2px solid ${C.petrol}` : "2px solid transparent" }} />
                      <div className="flex gap-2 items-start">
                        <button type="button" className="text-xs underline min-h-[28px]" style={{ color: C.petrol }} onClick={async () => { const r = await crmAction({ action: "automation.preview", text: s.text }); setPreview(p => ({ ...p, [i]: r.ok ? String(r.body) : r.error ?? "" })); }}>איך זה ייראה</button>
                        {preview[i] && <span className="text-xs" style={{ color: C.muted }}>{preview[i]}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Btn onClick={() => setDraft(d => [...(d ?? []), a.steps.some(x => x.beforeCallMinutes != null) ? { beforeCallMinutes: 60, text: "" } : { delayMinutes: 1440, text: "" }])}>+ הודעה</Btn>
              <Btn kind="dark" disabled={!dirty || busy || draft.some(s => !s.text.trim())} onClick={() => save({ action: "automation.update", id: a.id, steps: draft }, "נשמר")}>{busy ? "שומר…" : "שמור שינויים"}</Btn>
              {dirty && <Btn kind="ghost" onClick={() => setDraft(a.steps.map(s => ({ ...s })))}>בטל שינויים</Btn>}
            </div>

            <div className="flex flex-col gap-2 pt-2" style={{ borderTop: `1px solid ${C.soft}` }}>
              <span className="text-[13px] font-bold">משתנים (לחיצה מוסיפה להודעה המסומנת)</span>
              <div className="flex flex-wrap gap-1.5">
                {data.variables.map(v => <button key={v} type="button" onClick={() => insertVar(v)} className="h-8 px-2.5 rounded-lg text-[13px]" style={{ border: "1px solid #C7D8D5", background: C.ground, color: C.petrol }}>{v}</button>)}
              </div>
              {a.stopOn.length > 0 && <>
                <span className="text-[13px] font-bold mt-1.5">הרצף נעצר כש</span>
                <div className="flex flex-wrap gap-1.5">{a.stopOn.map(s => <span key={s} className="text-[13px] px-2.5 py-1.5 rounded-full" style={{ background: "#E3F7EF", color: "#0F6B4F" }}>{data.stopLabels[s] ?? s}</span>)}</div>
              </>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
