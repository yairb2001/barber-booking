"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { C, NUM, Btn, Card, PageHead, useCrm, crmAction } from "../ui";

/**
 * Sales-call calendar. Availability is set per specific week (10.10.2026,
 * Yair: "כל שבוע הלו״ז משתנה"): the rep opens days and hours for the week on
 * screen, and the agent books only inside them. The weekly template is just a
 * starting point ("כמו השבוע הרגיל"). One layout of day cards that wraps to
 * the screen, so a phone shows only the opened days, one under the other.
 */

type DateWin = { date: string; startTime: string; endTime: string };
type EditWin = DateWin & { id: string };
type Rep = { id: string; name: string; phone: string | null; active: boolean; isOwner: boolean; week: DateWin[]; lastWeek: DateWin[]; template: { dayOfWeek: number; startTime: string; endTime: string }[] };
type CallRow = { id: string; repId: string; leadId: string; status: string; outcome: string | null; date: string; time: string; name: string; shop: string };
type Data = { settings: { callMinutes: number; breakMinutes: number; horizonDays: number; minNoticeMinutes: number }; today: string; sunday: string; days: string[]; reps: Rep[]; calls: CallRow[] };

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const OUTCOME: Record<string, string> = { won: "נסגר", later: "לחזור", no_answer: "לא ענה", not_relevant: "לא רלוונטי" };
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;
const dowOf = (iso: string) => new Date(iso + "T12:00:00Z").getUTCDay();
let seq = 0;
const withId = (w: DateWin): EditWin => ({ ...w, id: `w${++seq}` });

export default function CalendarPage() {
  const [week, setWeek] = useState<string>("");
  const { data, error, reload } = useCrm<Data>(`view=calendar${week ? `&week=${week}` : ""}`);
  const [repId, setRepId] = useState<string>("");
  const [edit, setEdit] = useState<EditWin[] | null>(null);
  const [asTemplate, setAsTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [newRep, setNewRep] = useState({ open: false, name: "", phone: "" });

  useEffect(() => { if (data && !repId) setRepId(data.reps[0]?.id ?? ""); }, [data, repId]);
  const rep = data?.reps.find(r => r.id === repId) ?? null;
  useEffect(() => { setEdit(rep ? rep.week.map(withId) : null); setAsTemplate(false); }, [rep]);

  const nowIL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const step = (data?.settings.callMinutes ?? 10) + (data?.settings.breakMinutes ?? 5);
  const isPastDay = (d: string) => !!data && d < data.today;

  // Several windows a day are fine (a bit of morning, a bit of evening) — they just may not overlap.
  const windowsError = useMemo(() => {
    if (!edit) return null;
    for (const w of edit) if (toMin(w.endTime) <= toMin(w.startTime)) return `ב${DAYS[dowOf(w.date)]} ${dm(w.date)}: שעת הסיום ${w.endTime} לפני שעת ההתחלה ${w.startTime}.`;
    const dates = Array.from(new Set(edit.map(w => w.date)));
    for (const d of dates) {
      const day = edit.filter(w => w.date === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let i = 1; i < day.length; i++) if (toMin(day[i].startTime) < toMin(day[i - 1].endTime)) return `ב${DAYS[dowOf(d)]} ${dm(d)} יש שני חלונות חופפים.`;
    }
    return null;
  }, [edit]);
  const dirty = !!rep && !!edit && JSON.stringify(edit.map(({ date, startTime, endTime }) => ({ date, startTime, endTime })).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime)))
    !== JSON.stringify([...rep.week].sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime)));

  // The saved week → one card per opened day (or a day with a call), its slots in order.
  const dayCards = useMemo(() => {
    if (!data || !rep) return [];
    return data.days.map(d => {
      const wins = rep.week.filter(w => w.date === d);
      const calls = data.calls.filter(c => c.repId === rep.id && c.date === d && c.status !== "cancelled");
      const times = new Set<string>();
      for (const w of wins) for (let m = toMin(w.startTime); m + data.settings.callMinutes <= toMin(w.endTime); m += step) times.add(toHHMM(m));
      for (const c of calls) times.add(c.time);
      const slots = Array.from(times).sort().map(t => {
        const call = calls.find(c => c.time === t);
        const past = d < data.today || (d === data.today && t <= nowIL);
        return { t, call, past };
      });
      return { d, open: wins.length > 0, slots, calls: calls.length };
    }).filter(x => (x.open || x.calls > 0) && !(isPastDay(x.d) && x.calls === 0));
  }, [data, rep, step, nowIL]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true); setFlash(null);
    const r = await crmAction(body);
    setBusy(false); setFlash(r.ok ? done : r.error ?? "שגיאה");
    if (r.ok) await reload();
    return r;
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>טוען…</p>;
  const booked = rep ? data.calls.filter(c => c.repId === rep.id && c.status === "booked").length : 0;
  const fromLastWeek = rep ? rep.lastWeek.map(w => ({ ...w, date: addDays(w.date, 7) })).filter(w => !isPastDay(w.date)) : [];
  const fromTemplate = rep ? rep.template.map(w => ({ date: addDays(data.sunday, w.dayOfWeek), startTime: w.startTime, endTime: w.endTime })).filter(w => !isPastDay(w.date)) : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="יומן שיחות מכירה" sub={`הסוכן קובע רק בימים ובשעות שפתחת לשבוע הזה · שיחה ${data.settings.callMinutes} דקות + ${data.settings.breakMinutes} הפסקה`} actions={
        <div role="tablist" aria-label="נציג" className="flex flex-wrap gap-1.5">
          {data.reps.map(r => <button key={r.id} type="button" role="tab" aria-selected={r.id === repId} onClick={() => setRepId(r.id)} className="h-10 px-3.5 rounded-full text-sm" style={r.id === repId ? { background: C.petrol, color: "#fff" } : { background: "#fff", color: C.petrol, border: `1px solid ${C.line}` }}>{r.name}{!r.active ? " (מושבת)" : ""}</button>)}
          <button type="button" onClick={() => setNewRep(n => ({ ...n, open: !n.open }))} className="h-10 px-3.5 rounded-full text-sm" style={{ border: "1px dashed #8FB8B0", color: C.petrol }}>+ נציג מכירות</button>
        </div>
      } />
      {newRep.open && (
        <section className="rounded-2xl bg-white p-4 flex flex-wrap gap-3 items-end" style={{ border: `1px solid ${C.line}` }}>
          <label className="flex flex-col gap-1 text-xs flex-[1_1_160px]" style={{ color: C.muted }}>שם<input value={newRep.name} onChange={e => setNewRep(n => ({ ...n, name: e.target.value }))} className="h-11 rounded-xl px-3 text-sm text-slate-900" style={{ border: "1px solid #C7D8D5" }} /></label>
          <label className="flex flex-col gap-1 text-xs flex-[1_1_160px]" style={{ color: C.muted }}>טלפון (להתראות)<input dir="ltr" value={newRep.phone} onChange={e => setNewRep(n => ({ ...n, phone: e.target.value }))} className="h-11 rounded-xl px-3 text-sm text-slate-900" style={{ border: "1px solid #C7D8D5" }} /></label>
          <Btn kind="dark" disabled={!newRep.name.trim() || busy} onClick={async () => { const r = await act({ action: "rep.create", name: newRep.name, phone: newRep.phone }, "הנציג נוסף. עכשיו פתח לו ימים לשבוע"); if (r.ok) { setNewRep({ open: false, name: "", phone: "" }); setRepId(String(r.id)); } }}>הוסף</Btn>
          <p className="m-0 text-xs w-full" style={{ color: C.muted }}>כניסה נפרדת לנציג ל-CRM תתווסף בשלב הבא. בינתיים הוא מקבל את השיחות שלו בוואטסאפ.</p>
        </section>
      )}
      {flash && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: C.mist, color: C.petrol }}>{flash}</p>}

      {/* Week switcher */}
      <section className="bg-white rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-2" style={{ border: `1px solid ${C.line}` }}>
        <div className="font-bold text-[17px]" style={NUM}>{dm(data.sunday)} עד {dm(addDays(data.sunday, 6))}</div>
        <div className="flex items-center gap-1 text-sm">
          <button type="button" className="min-h-[40px] px-2.5 rounded-lg" style={{ border: `1px solid ${C.line}` }} onClick={() => setWeek(addDays(data.sunday, -7))}>→ קודם</button>
          <button type="button" className="min-h-[40px] px-2.5 rounded-lg" style={{ border: `1px solid ${C.line}` }} onClick={() => setWeek("")}>השבוע</button>
          <button type="button" className="min-h-[40px] px-2.5 rounded-lg" style={{ border: `1px solid ${C.line}` }} onClick={() => setWeek(addDays(data.sunday, 7))}>הבא ←</button>
          <span className="ms-1 whitespace-nowrap" style={{ color: C.muted }}>{booked} נקבעו</span>
        </div>
      </section>

      {/* The week as it is now: one card per opened day */}
      {dayCards.length === 0 ? (
        <section className="rounded-2xl p-4 text-sm" style={{ background: C.mist, color: C.petrol }}>
          עוד לא פתחת ימים לשבוע הזה, אז הסוכן לא יכול לקבוע בו שיחות. פתח ימים למטה.
        </section>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 230px), 1fr))" }}>
          {dayCards.map(({ d, open, slots }) => (
            <section key={d} className="bg-white rounded-2xl p-3.5 flex flex-col gap-2.5 min-w-0" style={{ border: `1px solid ${d === data.today ? C.petrol : C.line}` }}>
              <div className="flex items-baseline justify-between gap-2">
                <div><span className="font-bold">{DAYS[dowOf(d)]}</span> <span className="text-sm" style={{ ...NUM, color: C.muted }}>{dm(d)}{d === data.today ? " · היום" : ""}</span></div>
                {rep && open && !isPastDay(d) && <button type="button" disabled={busy} onClick={() => confirm(`לסגור את ${DAYS[dowOf(d)]} ${dm(d)} לשיחות חדשות? שיחות שכבר נקבעו נשארות.`) && act({ action: "rep.closeDay", repId: rep.id, date: d }, "היום נסגר לשיחות חדשות")} className="text-xs underline min-h-[32px]" style={{ color: C.muted }}>סגור יום</button>}
              </div>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(94px, 1fr))" }}>
                {slots.map(({ t, call, past }) => call ? (
                  <Link key={t} href={`/admin/crm/leads/${call.leadId}`} className="rounded-xl px-2.5 py-2 flex flex-col min-w-0" style={{ gridColumn: "1 / -1", background: call.status === "done" ? "#DDE7E5" : C.petrol, color: call.status === "done" ? C.ink : "#fff", textDecoration: "none" }}>
                    <span className="text-[13px] font-bold truncate"><span style={NUM}>{t}</span> · {call.name}</span>
                    <span className="text-[11px] truncate" style={{ color: call.status === "done" ? C.muted : "#A9C9C4" }}>{call.status === "done" ? `הסתיימה${call.outcome ? ` · ${OUTCOME[call.outcome] ?? ""}` : ""}` : call.shop || "שיחה"}</span>
                  </Link>
                ) : (
                  <div key={t} className="rounded-xl px-2 py-1.5 text-center" style={past ? { background: C.ground, color: "#8A9C9D" } : { border: "1px dashed #8FB8B0", color: "#0F6B4F" }}>
                    <div className="text-[13px] font-bold" style={NUM}>{t}</div>
                    <div className="text-[11px]">{past ? "עבר" : "פנוי"}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Open days and hours for THIS week */}
      {rep && edit && (
        <Card title={`ימים ושעות לשבוע ${dm(data.sunday)}–${dm(addDays(data.sunday, 6))}`} aside={rep.name}>
          <div className="flex flex-wrap gap-2 mb-3">
            {fromLastWeek.length > 0 && <Btn kind="outline" disabled={busy} onClick={() => setEdit(fromLastWeek.map(withId))}>כמו שבוע שעבר</Btn>}
            {fromTemplate.length > 0 && <Btn kind="outline" disabled={busy} onClick={() => setEdit(fromTemplate.map(withId))}>כמו השבוע הרגיל</Btn>}
            {edit.length > 0 && <Btn kind="ghost" disabled={busy} onClick={() => setEdit(edit.filter(w => isPastDay(w.date)))}>נקה הכל</Btn>}
          </div>
          <div className="flex flex-col">
            {data.days.map(d => {
              const past = isPastDay(d);
              const ws = edit.map((w, idx) => ({ w, idx })).filter(x => x.w.date === d).sort((a, b) => a.w.startTime.localeCompare(b.w.startTime));
              const setW = (idx: number, patch: Partial<DateWin>) => setEdit(ed => (ed ?? []).map((x, j) => (j === idx ? { ...x, ...patch } : x)));
              // A second window starts after the day's last one (morning → evening 18:00–19:00).
              const nextWindow = (): EditWin => {
                const last = ws[ws.length - 1]?.w;
                if (!last) return withId({ date: d, startTime: "12:00", endTime: "13:00" });
                const s0 = Math.min(Math.max(toMin(last.endTime) + 60, toMin(last.endTime) < 14 * 60 ? 18 * 60 : 0), 22 * 60);
                return withId({ date: d, startTime: toHHMM(s0), endTime: toHHMM(Math.min(s0 + 60, 23 * 60 + 55)) });
              };
              return (
                <div key={d} className="flex flex-col gap-1.5 py-2" style={{ borderBottom: `1px solid ${C.soft}`, opacity: past ? 0.55 : 1 }}>
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm font-semibold min-h-[40px]">
                      <input type="checkbox" disabled={past} checked={ws.length > 0} onChange={e => setEdit(ed => e.target.checked ? [...(ed ?? []), nextWindow()] : (ed ?? []).filter(x => x.date !== d))} className="w-[18px] h-[18px]" style={{ accentColor: C.petrol }} />
                      {DAYS[dowOf(d)]} <span className="font-normal" style={{ ...NUM, color: C.muted }}>{dm(d)}</span>
                    </label>
                    {past ? <span className="text-sm" style={{ color: "#8A9C9D" }}>עבר</span>
                      : ws.length === 0 ? <span className="text-sm" style={{ color: "#8A9C9D" }}>סגור</span>
                      : <button type="button" onClick={() => setEdit(ed => [...(ed ?? []), nextWindow()])} className="text-[13px] font-semibold min-h-[36px] px-2" style={{ color: C.petrol }}>+ עוד חלון</button>}
                  </div>
                  {!past && ws.map(({ w, idx }) => (
                    <div key={w.id} className="flex flex-wrap items-center gap-1.5 text-sm ps-1 sm:ps-7">
                      <span className="flex items-center gap-1" dir="ltr">
                        <input type="time" step={300} value={w.startTime} onChange={e => setW(idx, { startTime: e.target.value })} className="h-10 rounded-lg px-1" style={{ border: "1px solid #C7D8D5" }} aria-label={`${DAYS[dowOf(d)]} משעה`} />
                        –
                        <input type="time" step={300} value={w.endTime} onChange={e => setW(idx, { endTime: e.target.value })} className="h-10 rounded-lg px-1" style={{ border: "1px solid #C7D8D5" }} aria-label={`${DAYS[dowOf(d)]} עד שעה`} />
                      </span>
                      <button type="button" onClick={() => setEdit(ed => (ed ?? []).filter((_, j) => j !== idx))} aria-label={`הסר חלון ${w.startTime}–${w.endTime}`} className="w-10 h-10 rounded-lg text-base" style={{ color: "#B42318" }}>×</button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {windowsError && <p className="m-0 mt-2 text-[13px]" style={{ color: "#B42318" }}>{windowsError}</p>}
          <label className="flex items-center gap-2 text-sm mt-3 min-h-[40px]">
            <input type="checkbox" checked={asTemplate} onChange={e => setAsTemplate(e.target.checked)} className="w-[18px] h-[18px]" style={{ accentColor: C.petrol }} />
            זה גם השבוע הרגיל שלי (נקודת התחלה לשבועות הבאים)
          </label>
          <div className="flex flex-wrap gap-2 mt-2">
            <Btn kind="dark" disabled={busy || !!windowsError || (!dirty && !asTemplate)} onClick={() => act({ action: "rep.week", repId: rep.id, sunday: data.sunday, asTemplate, windows: edit.filter(w => !isPastDay(w.date)).map(({ date, startTime, endTime }) => ({ date, startTime, endTime })).concat(rep.week.filter(w => isPastDay(w.date))) }, "השבוע נשמר. הסוכן קובע רק בימים האלה")}>שמור את השבוע</Btn>
            {!rep.isOwner && <Btn kind={rep.active ? "danger" : "outline"} disabled={busy} onClick={() => act({ action: "rep.update", id: rep.id, active: !rep.active }, rep.active ? "הנציג הושבת" : "הנציג הופעל")}>{rep.active ? "השבת נציג" : "הפעל נציג"}</Btn>}
          </div>
          <p className="m-0 mt-3 text-xs leading-relaxed" style={{ color: C.muted }}>
            שיחה {data.settings.callMinutes} דקות, הפסקה {data.settings.breakMinutes}, עד {data.settings.horizonDays} ימים קדימה, לא פחות מ-{data.settings.minNoticeMinutes} דקות מראש. <Link href="/admin/crm/settings" style={{ color: C.petrol }}>לשנות</Link>
          </p>
        </Card>
      )}
    </div>
  );
}
