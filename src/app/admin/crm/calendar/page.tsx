"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { C, NUM, Btn, Card, PageHead, useCrm, crmAction } from "../ui";

type Win = { id: string; dayOfWeek: number; startTime: string; endTime: string };
type Rep = { id: string; name: string; phone: string | null; active: boolean; isOwner: boolean; windows: Win[]; daysOff: string[] };
type CallRow = { id: string; repId: string; leadId: string; status: string; outcome: string | null; date: string; time: string; name: string; shop: string };
type Data = { settings: { callMinutes: number; breakMinutes: number; horizonDays: number; minNoticeMinutes: number }; today: string; sunday: string; days: string[]; reps: Rep[]; calls: CallRow[] };

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}`;

export default function CalendarPage() {
  const [week, setWeek] = useState<string>("");
  const { data, error, reload } = useCrm<Data>(`view=calendar${week ? `&week=${week}` : ""}`);
  const [repId, setRepId] = useState<string>("");
  const [edit, setEdit] = useState<Win[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [newRep, setNewRep] = useState({ open: false, name: "", phone: "" });

  useEffect(() => { if (data && !repId) setRepId(data.reps[0]?.id ?? ""); }, [data, repId]);
  const rep = data?.reps.find(r => r.id === repId) ?? null;
  useEffect(() => { setEdit(rep ? rep.windows.map(w => ({ ...w })) : null); }, [rep]);

  const step = (data?.settings.callMinutes ?? 10) + (data?.settings.breakMinutes ?? 5);
  const grid = useMemo(() => {
    if (!data || !rep) return { times: [] as string[], days: [] as string[] };
    const days = data.days.filter(d => rep.windows.some(w => w.dayOfWeek === new Date(d + "T12:00:00Z").getUTCDay()) || data.calls.some(c => c.repId === rep.id && c.date === d));
    const set = new Set<string>();
    for (const w of rep.windows) for (let m = toMin(w.startTime); m + (data.settings.callMinutes) <= toMin(w.endTime); m += step) set.add(toHHMM(m));
    for (const c of data.calls.filter(c => c.repId === rep.id)) set.add(c.time);
    return { times: Array.from(set).sort(), days };
  }, [data, rep, step]);

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

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="יומן שיחות מכירה" sub={`הסוכן קובע רק בחלונות שהנציג פתח · שיחה ${data.settings.callMinutes} דקות + ${data.settings.breakMinutes} הפסקה`} actions={
        <div role="tablist" aria-label="נציג" className="flex flex-wrap gap-1.5">
          {data.reps.map(r => <button key={r.id} type="button" role="tab" aria-selected={r.id === repId} onClick={() => setRepId(r.id)} className="h-10 px-3.5 rounded-full text-sm" style={r.id === repId ? { background: C.petrol, color: "#fff" } : { background: "#fff", color: C.petrol, border: `1px solid ${C.line}` }}>{r.name}{!r.active ? " (מושבת)" : ""}</button>)}
          <button type="button" onClick={() => setNewRep(n => ({ ...n, open: !n.open }))} className="h-10 px-3.5 rounded-full text-sm" style={{ border: "1px dashed #8FB8B0", color: C.petrol }}>+ נציג מכירות</button>
        </div>
      } />
      {newRep.open && (
        <section className="rounded-2xl bg-white p-4 flex flex-wrap gap-3 items-end" style={{ border: `1px solid ${C.line}` }}>
          <label className="flex flex-col gap-1 text-xs flex-[1_1_160px]" style={{ color: C.muted }}>שם<input value={newRep.name} onChange={e => setNewRep(n => ({ ...n, name: e.target.value }))} className="h-11 rounded-xl px-3 text-sm text-slate-900" style={{ border: "1px solid #C7D8D5" }} /></label>
          <label className="flex flex-col gap-1 text-xs flex-[1_1_160px]" style={{ color: C.muted }}>טלפון (להתראות)<input dir="ltr" value={newRep.phone} onChange={e => setNewRep(n => ({ ...n, phone: e.target.value }))} className="h-11 rounded-xl px-3 text-sm text-slate-900" style={{ border: "1px solid #C7D8D5" }} /></label>
          <Btn kind="dark" disabled={!newRep.name.trim() || busy} onClick={async () => { const r = await act({ action: "rep.create", name: newRep.name, phone: newRep.phone }, "הנציג נוסף. עכשיו פתח לו חלונות"); if (r.ok) { setNewRep({ open: false, name: "", phone: "" }); setRepId(String(r.id)); } }}>הוסף</Btn>
          <p className="m-0 text-xs w-full" style={{ color: C.muted }}>כניסה נפרדת לנציג ל-CRM תתווסף בשלב הבא. בינתיים הוא מקבל את השיחות שלו בוואטסאפ.</p>
        </section>
      )}
      {flash && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: C.mist, color: C.petrol }}>{flash}</p>}

      <div className="flex flex-wrap gap-4 items-start">
        <Card className="flex-[999_1_560px] min-w-0" title={`השבוע: ${dm(data.sunday)} עד ${dm(addDays(data.sunday, 6))}`} aside={<span className="flex items-center gap-2">
          <button type="button" className="min-h-[36px] px-2" onClick={() => setWeek(addDays(data.sunday, -7))}>→ קודם</button>
          <button type="button" className="min-h-[36px] px-2" onClick={() => setWeek("")}>היום</button>
          <button type="button" className="min-h-[36px] px-2" onClick={() => setWeek(addDays(data.sunday, 7))}>הבא ←</button>
          <span>{booked} נקבעו</span>
        </span>}>
          {grid.days.length === 0 ? <p className="m-0 text-sm" style={{ color: C.muted }}>אין לנציג חלונות פתוחים. פתח חלון בצד.</p> : (
            <div className="overflow-x-auto">
              <div className="grid gap-2" style={{ gridTemplateColumns: `64px repeat(${grid.days.length}, minmax(120px, 1fr))`, minWidth: 64 + grid.days.length * 128 }}>
                <span />
                {grid.days.map(d => {
                  const off = rep?.daysOff.includes(d);
                  return (
                    <div key={d} className="text-center py-1.5 flex flex-col">
                      <span className="font-bold text-sm" style={{ color: d === data.today ? C.petrol : C.ink }}>{DAYS[new Date(d + "T12:00:00Z").getUTCDay()]}</span>
                      <span className="text-xs" style={{ color: C.muted }}>{dm(d)}</span>
                      {rep && <button type="button" disabled={busy} onClick={() => act({ action: "rep.dayOff", repId: rep.id, date: d, off: !off }, off ? "היום נפתח" : "היום נסגר לשיחות חדשות")} className="text-[11px] underline min-h-[28px]" style={{ color: off ? "#0F6B4F" : C.muted }}>{off ? "פתח יום" : "סגור יום"}</button>}
                    </div>
                  );
                })}
                {grid.times.map(t => (
                  <div key={t} className="contents">
                    <span className="text-sm font-semibold pt-3" style={{ ...NUM, color: C.muted }}>{t}</span>
                    {grid.days.map(d => {
                      const call = data.calls.find(c => c.repId === rep?.id && c.date === d && c.time === t && c.status !== "cancelled");
                      const dow = new Date(d + "T12:00:00Z").getUTCDay();
                      const inWin = rep?.windows.some(w => w.dayOfWeek === dow && toMin(t) >= toMin(w.startTime) && toMin(t) + data.settings.callMinutes <= toMin(w.endTime));
                      const off = rep?.daysOff.includes(d);
                      if (call) return (
                        <Link key={d} href={`/admin/crm/leads/${call.leadId}`} className="min-h-[64px] rounded-xl px-2.5 py-2 flex flex-col gap-0.5" style={{ background: call.status === "done" ? "#DDE7E5" : C.petrol, color: call.status === "done" ? C.ink : "#fff", textDecoration: "none" }}>
                          <span className="text-[13px] font-bold">{call.name}</span>
                          <span className="text-[11px]" style={{ color: call.status === "done" ? C.muted : "#A9C9C4" }}>{call.status === "done" ? `הסתיימה${call.outcome ? ` · ${({ won: "נסגר", later: "לחזור", no_answer: "לא ענה", not_relevant: "לא רלוונטי" } as Record<string, string>)[call.outcome] ?? ""}` : ""}` : call.shop}</span>
                        </Link>
                      );
                      const nowIL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
                      const past = d < data.today || (d === data.today && t <= nowIL);
                      if (past && inWin) return <div key={d} className="min-h-[64px] rounded-xl px-2.5 py-2" style={{ background: C.ground }}><span className="text-[13px]" style={{ color: "#8A9C9D" }}>עבר</span></div>;
                      if (inWin && !off) return <div key={d} className="min-h-[64px] rounded-xl px-2.5 py-2" style={{ border: "1px dashed #8FB8B0" }}><span className="text-[13px] font-bold" style={{ color: "#0F6B4F" }}>פנוי</span><br /><span className="text-[11px]" style={{ color: C.muted }}>הסוכן יכול לקבוע</span></div>;
                      return <div key={d} className="min-h-[64px] rounded-xl px-2.5 py-2" style={{ background: C.soft }}><span className="text-[13px]" style={{ color: "#8A9C9D" }}>סגור</span></div>;
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <aside className="flex-[1_1_300px] min-w-0 flex flex-col gap-4">
          {rep && edit && (
            <Card title={`החלונות של ${rep.name}`}>
              <div className="flex flex-col gap-2">
                {DAYS.map((name, dow) => {
                  const w = edit.find(x => x.dayOfWeek === dow);
                  return (
                    <div key={dow} className="flex items-center justify-between gap-2 pb-2" style={{ borderBottom: `1px solid ${C.soft}` }}>
                      <label className="flex items-center gap-2 text-sm font-semibold min-h-[40px]">
                        <input type="checkbox" checked={!!w} onChange={e => setEdit(ed => e.target.checked ? [...(ed ?? []), { id: `n${dow}`, dayOfWeek: dow, startTime: "12:00", endTime: "13:00" }] : (ed ?? []).filter(x => x.dayOfWeek !== dow))} className="w-[18px] h-[18px]" style={{ accentColor: C.petrol }} />{name}
                      </label>
                      {w ? (
                        <span className="flex items-center gap-1 text-sm" dir="ltr">
                          <input type="time" step={300} value={w.startTime} onChange={e => setEdit(ed => (ed ?? []).map(x => x.dayOfWeek === dow ? { ...x, startTime: e.target.value } : x))} className="h-9 rounded-lg px-1" style={{ border: "1px solid #C7D8D5" }} aria-label={`${name} משעה`} />
                          –
                          <input type="time" step={300} value={w.endTime} onChange={e => setEdit(ed => (ed ?? []).map(x => x.dayOfWeek === dow ? { ...x, endTime: e.target.value } : x))} className="h-9 rounded-lg px-1" style={{ border: "1px solid #C7D8D5" }} aria-label={`${name} עד שעה`} />
                        </span>
                      ) : <span className="text-sm" style={{ color: "#8A9C9D" }}>סגור</span>}
                    </div>
                  );
                })}
                <Btn kind="dark" disabled={busy} onClick={() => act({ action: "rep.windows", repId: rep.id, windows: edit.map(w => ({ dayOfWeek: w.dayOfWeek, startTime: w.startTime, endTime: w.endTime })) }, "החלונות נשמרו")}>שמור חלונות</Btn>
                {!rep.isOwner && <Btn kind={rep.active ? "danger" : "outline"} disabled={busy} onClick={() => act({ action: "rep.update", id: rep.id, active: !rep.active }, rep.active ? "הנציג הושבת" : "הנציג הופעל")}>{rep.active ? "השבת נציג" : "הפעל נציג"}</Btn>}
              </div>
            </Card>
          )}
          <Card title="כללי קביעה">
            <p className="m-0 text-sm leading-relaxed" style={{ color: C.muted }}>שיחה {data.settings.callMinutes} דקות, הפסקה {data.settings.breakMinutes}, עד {data.settings.horizonDays} ימים קדימה, לא פחות מ-{data.settings.minNoticeMinutes} דקות מראש.</p>
            <Link href="/admin/crm/settings" className="text-sm" style={{ color: C.petrol }}>לשנות בהגדרות ←</Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}
