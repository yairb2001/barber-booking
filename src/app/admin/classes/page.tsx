"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/**
 * The classes board (16.10.2026): a week of sessions, each with who is in it
 * and who waits. Add someone, take someone out (the first in line moves up and
 * is told), mark who came, cancel a session (everyone in it is told).
 */
type Person = { bookingId: string; status: string; id: string; name: string; phone: string };
type Session = { id: string; name: string; date: string; startTime: string; endTime: string; staffName: string | null; capacity: number; booked: number; waiting: number; status: string; people: Person[] };

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const weekStart = (s: string) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return iso(d); };
const dayTitle = (s: string) => { const d = new Date(s + "T00:00:00Z"); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`; };

export default function ClassesBoard() {
  const [from, setFrom] = useState(() => weekStart(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)));
  const [rows, setRows] = useState<Session[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [add, setAdd] = useState({ name: "", phone: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => fetch(`/api/admin/classes/sessions?from=${from}&to=${addDays(from, 6)}`).then(r => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([])), [from]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  async function act(id: string, body: Record<string, unknown>) {
    setBusy(true);
    const r = await fetch(`/api/admin/classes/sessions/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) alert((await r?.json().catch(() => ({})))?.error || "לא בוצע");
    await load();
  }

  const byDay = (rows ?? []).reduce<Record<string, Session[]>>((a, s) => { (a[s.date] ??= []).push(s); return a; }, {});

  return (
    <div className="p-4 sm:p-8 overflow-auto h-full" dir="rtl">
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">🧘 לוח השיעורים</h1>
          <p className="text-sm text-neutral-500 mt-0.5">{dayTitle(from)} – {dayTitle(addDays(from, 6))}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setFrom(addDays(from, -7))} className="text-sm px-3 py-1.5 rounded-lg border border-neutral-200">→ שבוע קודם</button>
          <button type="button" onClick={() => setFrom(addDays(from, 7))} className="text-sm px-3 py-1.5 rounded-lg border border-neutral-200">שבוע הבא ←</button>
          <Link href="/admin/settings/classes" className="text-sm text-teal-700 px-2">הגדרות</Link>
        </div>
      </div>

      {rows === null ? <p className="text-center text-neutral-400 py-12">טוען...</p> : rows.length === 0 ? (
        <p className="text-center text-neutral-500 py-12">אין שיעורים בשבוע הזה. <Link href="/admin/settings/classes" className="text-teal-700 underline">להגדרת שיעורים</Link></p>
      ) : (
        <div className="space-y-5 max-w-2xl">
          {Object.entries(byDay).map(([day, list]) => (
            <div key={day}>
              <h2 className="text-xs font-semibold text-neutral-500 mb-2">{dayTitle(day)}</h2>
              <div className="space-y-2">
                {list.map(s => {
                  const cancelled = s.status !== "scheduled";
                  const inClass = s.people.filter(p => p.status !== "waitlist");
                  const waiting = s.people.filter(p => p.status === "waitlist");
                  return (
                    <div key={s.id} className={`bg-white rounded-2xl border p-4 ${cancelled ? "opacity-50 border-neutral-100" : "border-neutral-200"}`}>
                      <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="w-full text-right flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-neutral-900">{s.startTime} {s.name}{cancelled ? " · בוטל" : ""}</p>
                          <p className="text-xs text-neutral-500">{s.staffName ?? ""}</p>
                        </div>
                        <span className={`text-sm font-bold ${s.booked >= s.capacity ? "text-amber-700" : "text-teal-700"}`}>{s.booked}/{s.capacity}</span>
                        {s.waiting > 0 && <span className="text-xs text-amber-700">+{s.waiting} בהמתנה</span>}
                      </button>
                      {open === s.id && (
                        <div className="mt-3 border-t border-neutral-100 pt-3 space-y-2">
                          {inClass.length === 0 && <p className="text-sm text-neutral-400">עוד אין נרשמים.</p>}
                          {inClass.map(p => (
                            <div key={p.bookingId} className="flex items-center gap-2 text-sm">
                              <span className="flex-1">{p.name} <span className="text-neutral-400 text-xs" dir="ltr">{p.phone}</span></span>
                              {!cancelled && <>
                                <button type="button" disabled={busy} onClick={() => void act(s.id, { action: "mark", bookingId: p.bookingId, status: p.status === "attended" ? "booked" : "attended" })}
                                  className={`text-xs px-2 py-1 rounded-full border ${p.status === "attended" ? "bg-teal-600 text-white border-transparent" : "border-neutral-200 text-neutral-500"}`}>הגיע</button>
                                <button type="button" disabled={busy} onClick={() => { if (confirm(`להוציא את ${p.name} מהשיעור?`)) void act(s.id, { action: "remove", bookingId: p.bookingId }); }} className="text-xs text-red-400 px-1">הוצאה</button>
                              </>}
                            </div>
                          ))}
                          {waiting.length > 0 && (
                            <div className="pt-1">
                              <p className="text-xs text-amber-700 mb-1">רשימת המתנה (לפי הסדר)</p>
                              {waiting.map((p, i) => (
                                <div key={p.bookingId} className="flex items-center gap-2 text-sm text-neutral-600">
                                  <span className="flex-1">{i + 1}. {p.name}</span>
                                  {!cancelled && <button type="button" disabled={busy} onClick={() => void act(s.id, { action: "remove", bookingId: p.bookingId })} className="text-xs text-red-400 px-1">הוצאה</button>}
                                </div>
                              ))}
                            </div>
                          )}
                          {!cancelled && (
                            <div className="flex gap-2 pt-2">
                              <input value={add.name} onChange={e => setAdd(a => ({ ...a, name: e.target.value }))} placeholder="שם" className="flex-1 min-w-0 border border-neutral-200 rounded-lg px-2 py-1.5 text-sm" />
                              <input value={add.phone} onChange={e => setAdd(a => ({ ...a, phone: e.target.value }))} placeholder="טלפון" dir="ltr" className="w-32 border border-neutral-200 rounded-lg px-2 py-1.5 text-sm" />
                              <button type="button" disabled={busy || !add.name.trim() || !add.phone.trim()} onClick={async () => { await act(s.id, { action: "add", name: add.name, phone: add.phone }); setAdd({ name: "", phone: "" }); }} className="text-sm bg-teal-600 text-white px-3 rounded-lg disabled:opacity-50">הוספה</button>
                            </div>
                          )}
                          {!cancelled && (
                            <button type="button" disabled={busy} onClick={() => { if (confirm(`לבטל את ${s.name} ב-${s.startTime}? כל ${inClass.length + waiting.length} הרשומים יקבלו הודעה.`)) void act(s.id, { action: "cancel" }); }}
                              className="text-xs text-red-500 border border-red-100 rounded-lg px-2 py-1 mt-1">ביטול השיעור</button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
