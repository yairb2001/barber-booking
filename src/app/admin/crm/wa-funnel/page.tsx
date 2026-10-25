"use client";

import { useEffect, useState } from "react";
import { C, NUM, Btn, Card, PageHead, useCrm, crmAction } from "../ui";
import SettingsTabs from "../SettingsTabs";

type Unit = "minutes" | "hours" | "days";
type Step = { id: string; wait: number; unit: Unit; at?: number; text: string; on: boolean };
type Config = {
  enabled: boolean; enabledAt: string | null; notRelevantDays: number;
  repLine: string; repLineFirstReply: boolean; repLineFollowups: boolean; repReply: string;
  hours: { weekdayFrom: number; weekdayTo: number; fridayTo: number };
  stages: Record<string, Step[]>;
};
type Data = { config: Config; defaults: Config; variables: string[]; stages: { key: string; label: string }[] };

const WHEN: Record<string, string> = {
  opened: "כתב לצ׳אטור ועוד לא נכנס לדמו",
  tried: "נכנס למספרה של דני ועוד לא קבע תור",
  booked: "קבע תור בדמו",
  signup_link: "קיבל קישור הרשמה ועוד לא נרשם",
};
const field = "h-10 rounded-lg px-2 text-sm";
const border = { border: "1px solid #C7D8D5" };

/** "אחרי 1 ימים ב-10:00" → "למחרת ב-10:00", for the line under each step. */
function whenText(s: Step): string {
  if (s.unit === "minutes") return `${s.wait} דקות אחרי ההודעה האחרונה שלו`;
  if (s.unit === "hours") return s.wait === 1 ? "שעה אחרי ההודעה האחרונה שלו" : s.wait === 2 ? "שעתיים אחרי ההודעה האחרונה שלו" : `${s.wait} שעות אחרי ההודעה האחרונה שלו`;
  const at = `ב-${String(s.at ?? 10).padStart(2, "0")}:00`;
  return s.wait === 1 ? `למחרת ${at}` : s.wait === 2 ? `מחרתיים ${at}` : `${s.wait} ימים אחרי, ${at}`;
}

/**
 * The WhatsApp funnel's settings (25.10.2026, Yair: "אני רוצה לערוך את זה דרך ההגדרות.
 * את כל הפלואו הזה"): the switch, the general rules, the "נציג" lines, and each stage's
 * follow-ups (when, what, on or off, add or remove).
 */
export default function WaFunnelSettingsPage() {
  const { data, error, reload } = useCrm<Data>("view=waFunnel");
  const [draft, setDraft] = useState<Config | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => { if (data) setDraft(structuredClone(data.config)); }, [data]);
  const dirty = !!data && !!draft && JSON.stringify(data.config) !== JSON.stringify(draft);

  async function save(next: Config, done: string) {
    setBusy(true); setFlash(null);
    const r = await crmAction({ action: "waFunnel.save", config: next });
    setBusy(false); setFlash(r.ok ? done : r.error ?? "שגיאה");
    if (r.ok) await reload();
  }
  const set = (patch: Partial<Config>) => setDraft(d => (d ? { ...d, ...patch } : d));
  const setStep = (stage: string, i: number, patch: Partial<Step>) => setDraft(d => (d ? { ...d, stages: { ...d.stages, [stage]: d.stages[stage].map((s, j) => (j === i ? { ...s, ...patch } : s)) } } : d));
  function insertVar(v: string) {
    if (!focus || !draft) return;
    const [stage, idx] = focus.split(":");
    const s = draft.stages[stage]?.[Number(idx)];
    if (s) setStep(stage, Number(idx), { text: `${s.text}${s.text.endsWith(" ") || !s.text ? "" : " "}${v}` });
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data || !draft) return <p style={{ color: C.muted }}>טוען…</p>;

  return (
    <div className="flex flex-col gap-4 pb-24">
      <PageHead title="הגדרות" />
      <SettingsTabs />
      {flash && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: C.mist, color: C.petrol }}>{flash}</p>}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 text-[19px] font-extrabold">משפך וואטסאפ</h2>
            <p className="m-0 mt-1 text-sm" style={{ color: C.muted }}>מי שכתב לצ׳אטור ונעצר מקבל את ההודעות של השלב שלו. כשהוא כותב נציג, מבקש פרטים או שיחה, הוא עובר ללידים.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold min-h-[44px]">
            <input type="checkbox" checked={data.config.enabled} disabled={busy} onChange={e => save({ ...(dirty ? draft : data.config), enabled: e.target.checked }, e.target.checked ? "המשפך פועל. הודעות יוצאות רק לשיחות שנעצרות מעכשיו." : "המשפך כבוי")} className="w-5 h-5" style={{ accentColor: C.petrol }} />
            {data.config.enabled ? "פועל" : "כבוי"}
          </label>
        </div>
      </Card>

      <Card title="כללי">
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <label className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">לא רלוונטי אחרי</span>
              <input type="number" min={1} max={30} value={draft.notRelevantDays} onChange={e => set({ notRelevantDays: Number(e.target.value) || 1 })} className={`${field} w-16`} style={border} aria-label="ימים" />
              <span>ימים בלי תגובה</span>
            </label>
            <span className="text-xs" style={{ color: C.muted }}>נספר מההודעה האחרונה של השלב. אם יכתוב שוב, הוא חוזר לשלב שלו.</span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="font-semibold">שעות שליחה</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20">א׳ עד ה׳</span>
              <span>מ</span>
              <input type="number" min={0} max={23} value={draft.hours.weekdayFrom} onChange={e => set({ hours: { ...draft.hours, weekdayFrom: Number(e.target.value) } })} className={`${field} w-16`} style={border} aria-label="א׳ עד ה׳ משעה" />
              <span>עד</span>
              <input type="number" min={1} max={24} value={draft.hours.weekdayTo} onChange={e => set({ hours: { ...draft.hours, weekdayTo: Number(e.target.value) } })} className={`${field} w-16`} style={border} aria-label="א׳ עד ה׳ עד שעה" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20">שישי</span>
              <span>עד</span>
              <input type="number" min={0} max={24} value={draft.hours.fridayTo} onChange={e => set({ hours: { ...draft.hours, fridayTo: Number(e.target.value) } })} className={`${field} w-16`} style={border} aria-label="שישי עד שעה" />
            </div>
            <span className="text-xs" style={{ color: C.muted }}>בשבת לא שולחים. מה שנופל מחוץ לשעות יוצא כשהן נפתחות.</span>
          </div>
        </div>
      </Card>

      <Card title="נציג">
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1.5">
            <span className="font-semibold">השורה שמזכירה שיש בן אדם</span>
            <input value={draft.repLine} onChange={e => set({ repLine: e.target.value })} className="h-11 rounded-xl px-3 text-sm" style={border} />
          </label>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <label className="flex items-center gap-2 min-h-[40px]"><input type="checkbox" checked={draft.repLineFirstReply} onChange={e => set({ repLineFirstReply: e.target.checked })} className="w-5 h-5" style={{ accentColor: C.petrol }} />בתשובה הראשונה</label>
            <label className="flex items-center gap-2 min-h-[40px]"><input type="checkbox" checked={draft.repLineFollowups} onChange={e => set({ repLineFollowups: e.target.checked })} className="w-5 h-5" style={{ accentColor: C.petrol }} />בכל הודעת המשך שלא כתוב בה נציג</label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="font-semibold">מה עונים למי שכותב נציג</span>
            <textarea value={draft.repReply} onChange={e => set({ repReply: e.target.value })} rows={2} className="w-full rounded-[14px] px-3 py-2.5 text-sm leading-relaxed resize-y" style={{ background: "#D9FDD3" }} />
            <span className="text-xs" style={{ color: C.muted }}>{"{שעות לשיחה}"} = שתי שעות פנויות ביומן לשיחה. אחרי התשובה הוא ליד, והנציג מקבל התראה.</span>
          </label>
        </div>
      </Card>

      {data.stages.map((st, si) => {
        const steps = draft.stages[st.key] ?? [];
        return (
          <Card key={st.key} title={<span className="inline-flex items-center gap-2"><span className="w-7 h-7 rounded-full inline-flex items-center justify-center text-xs font-bold" style={{ ...NUM, background: C.petrol, color: "#fff" }}>{si + 1}</span>{st.label}</span>} aside={WHEN[st.key]}>
            <ol className="list-none m-0 p-0 flex flex-col gap-4">
              {steps.length === 0 && <li className="text-sm" style={{ color: C.muted }}>אין הודעות בשלב הזה.</li>}
              {steps.map((s, i) => (
                <li key={s.id} className="flex flex-col gap-2" style={{ opacity: s.on ? 1 : 0.55 }}>
                  <div className="flex flex-wrap items-center gap-2 text-[13px] font-bold" style={{ color: C.petrol }}>
                    <span>אחרי</span>
                    <input type="number" min={1} value={s.wait} onChange={e => setStep(st.key, i, { wait: Math.max(1, Number(e.target.value) || 1) })} className={`${field} w-16 font-normal`} style={border} aria-label="כמה זמן" />
                    <select value={s.unit} onChange={e => { const unit = e.target.value as Unit; setStep(st.key, i, { unit, ...(unit === "days" ? { at: s.at ?? 10 } : { at: undefined }) }); }} className={`${field} font-normal`} style={border} aria-label="יחידה">
                      <option value="minutes">דקות</option><option value="hours">שעות</option><option value="days">ימים</option>
                    </select>
                    {s.unit === "days" && <>
                      <span>בשעה</span>
                      <select value={s.at ?? 10} onChange={e => setStep(st.key, i, { at: Number(e.target.value) })} className={`${field} font-normal`} style={border} aria-label="שעה">
                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>)}
                      </select>
                    </>}
                    <label className="flex items-center gap-1.5 font-semibold ms-auto min-h-[36px]" style={{ color: C.ink }}>
                      <input type="checkbox" checked={s.on} onChange={e => setStep(st.key, i, { on: e.target.checked })} className="w-5 h-5" style={{ accentColor: C.petrol }} />פעילה
                    </label>
                    <button type="button" onClick={() => setDraft(d => (d ? { ...d, stages: { ...d.stages, [st.key]: d.stages[st.key].filter((_, j) => j !== i) } } : d))} className="text-xs font-semibold min-h-[36px] px-1" style={{ color: "#B42318" }}>מחק</button>
                  </div>
                  <span className="text-xs -mt-1" style={{ color: C.muted }}>{whenText(s)}</span>
                  <label className="sr-only" htmlFor={`m-${st.key}-${i}`}>נוסח ההודעה</label>
                  <textarea id={`m-${st.key}-${i}`} value={s.text} onFocus={() => setFocus(`${st.key}:${i}`)} onChange={e => setStep(st.key, i, { text: e.target.value })} rows={3} className="w-full rounded-[14px] px-3 py-2.5 text-sm leading-relaxed resize-y" style={{ background: "#D9FDD3", border: focus === `${st.key}:${i}` ? `2px solid ${C.petrol}` : "2px solid transparent" }} />
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Btn onClick={() => setDraft(d => (d ? { ...d, stages: { ...d.stages, [st.key]: [...d.stages[st.key], { id: `${st.key[0]}${Date.now() % 100000}`, wait: 1, unit: "days", at: 10, text: "", on: true }] } } : d))}>+ עוד הודעה</Btn>
              {JSON.stringify(steps) !== JSON.stringify(data.defaults.stages[st.key]) && <Btn kind="ghost" onClick={() => setDraft(d => (d ? { ...d, stages: { ...d.stages, [st.key]: structuredClone(data.defaults.stages[st.key]) } } : d))}>חזרה לנוסח המקורי</Btn>}
            </div>
          </Card>
        );
      })}

      <Card title="משתנים">
        <p className="m-0 mb-2 text-sm" style={{ color: C.muted }}>לחיצה מוסיפה להודעה שמסומנת. שם שלא ידוע פשוט נעלם מהמשפט.</p>
        <div className="flex flex-wrap gap-1.5">
          {data.variables.map(v => <button key={v} type="button" onClick={() => insertVar(v)} disabled={!focus} className="h-9 px-3 rounded-lg text-[13px] disabled:opacity-50" style={{ border: "1px solid #C7D8D5", background: C.ground, color: C.petrol }}>{v}</button>)}
        </div>
      </Card>

      {dirty && (
        <div className="fixed bottom-0 inset-x-0 z-20 px-4 py-3 flex justify-center gap-2" style={{ background: "rgba(244,247,246,.96)", borderTop: `1px solid ${C.line}` }}>
          <Btn kind="dark" disabled={busy} onClick={() => save(draft, "נשמר")}>{busy ? "שומר…" : "שמור שינויים"}</Btn>
          <Btn kind="ghost" onClick={() => setDraft(structuredClone(data.config))}>בטל</Btn>
        </div>
      )}
    </div>
  );
}
