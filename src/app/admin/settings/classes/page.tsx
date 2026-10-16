"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useVocab } from "@/components/VocabProvider";

/**
 * Group classes, the setup (16.10.2026, Yair: "אם זה חדרי כושר זה קבוצות"):
 * each class with its length, spots, price, trainer, room and weekly times.
 * Saving makes the sessions of the coming weeks; each blocks its trainer.
 */
type Row = { dayOfWeek: number; startTime: string; staffId: string | null };
type ClassType = { id?: string; name: string; description: string | null; durationMinutes: number; capacity: number; price: number; staffId: string | null; roomId: string | null; cancelHours: number; schedules: Row[] };
type Opt = { id: string; name: string };

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const blank = (): ClassType => ({ name: "", description: null, durationMinutes: 50, capacity: 12, price: 0, staffId: null, roomId: null, cancelHours: 6, schedules: [{ dayOfWeek: 0, startTime: "18:00", staffId: null }] });
const input = "w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400";

function Editor({ value, staff, rooms, onSave, onCancel, onDelete }: { value: ClassType; staff: Opt[]; rooms: Opt[]; onSave: (c: ClassType) => Promise<void>; onCancel: () => void; onDelete?: () => void }) {
  const v = useVocab();
  const [c, setC] = useState<ClassType>(value);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ClassType>(k: K, val: ClassType[K]) => setC(p => ({ ...p, [k]: val }));
  const setRow = (i: number, r: Partial<Row>) => setC(p => ({ ...p, schedules: p.schedules.map((x, j) => (j === i ? { ...x, ...r } : x)) }));
  return (
    <div className="bg-white rounded-2xl border border-teal-300 p-5 space-y-3">
      <div>
        <label className="text-xs text-neutral-500 block mb-1">שם השיעור *</label>
        <input value={c.name} onChange={e => set("name", e.target.value)} placeholder="למשל: פילאטיס מכשירים" className={input} />
      </div>
      <div>
        <label className="text-xs text-neutral-500 block mb-1">תיאור קצר <span className="text-neutral-400">(מוצג בהרשמה, והסוכן משתמש בו)</span></label>
        <input value={c.description ?? ""} onChange={e => set("description", e.target.value)} className={input} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div><label className="text-xs text-neutral-500 block mb-1">משך (דק׳)</label><input type="number" min="5" step="5" value={c.durationMinutes} onChange={e => set("durationMinutes", parseInt(e.target.value) || 0)} className={input} dir="ltr" /></div>
        <div><label className="text-xs text-neutral-500 block mb-1">מקומות</label><input type="number" min="1" value={c.capacity} onChange={e => set("capacity", parseInt(e.target.value) || 0)} className={input} dir="ltr" /></div>
        <div><label className="text-xs text-neutral-500 block mb-1">מחיר ₪</label><input type="number" min="0" value={c.price} onChange={e => set("price", parseFloat(e.target.value) || 0)} className={input} dir="ltr" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-neutral-500 block mb-1">{v.staff} {v.staffFem ? "קבועה" : "קבוע"}</label>
          <select value={c.staffId ?? ""} onChange={e => set("staffId", e.target.value || null)} className={input}>
            <option value="">בלי</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-neutral-500 block mb-1">ביטול עד (שעות לפני)</label>
          <input type="number" min="0" value={c.cancelHours} onChange={e => set("cancelHours", parseInt(e.target.value) || 0)} className={input} dir="ltr" />
        </div>
      </div>
      {rooms.length > 0 && (
        <div>
          <label className="text-xs text-neutral-500 block mb-1">חדר</label>
          <select value={c.roomId ?? ""} onChange={e => set("roomId", e.target.value || null)} className={input}>
            <option value="">בלי חדר</option>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="text-xs text-neutral-500 block mb-1.5">מערכת שעות שבועית</label>
        <div className="space-y-2">
          {c.schedules.map((r, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select value={r.dayOfWeek} onChange={e => setRow(i, { dayOfWeek: parseInt(e.target.value) })} className={`${input} !w-28`}>
                {DAYS.map((d, k) => <option key={k} value={k}>{d}</option>)}
              </select>
              <input type="time" value={r.startTime} onChange={e => setRow(i, { startTime: e.target.value })} className={`${input} !w-28`} dir="ltr" />
              <select value={r.staffId ?? ""} onChange={e => setRow(i, { staffId: e.target.value || null })} className={`${input} flex-1`}>
                <option value="">{c.staffId ? `כרגיל (${staff.find(s => s.id === c.staffId)?.name ?? ""})` : `${v.staff} ${v.staffFem ? "קבועה" : "קבוע"}`}</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" onClick={() => setC(p => ({ ...p, schedules: p.schedules.filter((_, j) => j !== i) }))} className="text-xs text-red-400 px-2">הסר</button>
            </div>
          ))}
          <button type="button" onClick={() => setC(p => ({ ...p, schedules: [...p.schedules, { dayOfWeek: p.schedules.at(-1)?.dayOfWeek ?? 0, startTime: p.schedules.at(-1)?.startTime ?? "18:00", staffId: null }] }))} className="text-sm text-teal-700 font-medium">+ עוד שעה בשבוע</button>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2">
        <button type="button" disabled={busy || !c.name.trim() || c.durationMinutes < 5 || c.capacity < 1} onClick={async () => { setBusy(true); await onSave(c); setBusy(false); }}
          className="bg-teal-600 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">{busy ? "שומר..." : "שמירה"}</button>
        <button type="button" onClick={onCancel} className="text-sm text-neutral-500 px-3 py-2">ביטול</button>
        {onDelete && <button type="button" onClick={onDelete} className="mr-auto text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg border border-neutral-200">הפסקת השיעור</button>}
      </div>
    </div>
  );
}

export default function ClassesSettingsPage() {
  const v = useVocab();
  const [types, setTypes] = useState<ClassType[] | null>(null);
  const [staff, setStaff] = useState<Opt[]>([]);
  const [rooms, setRooms] = useState<Opt[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const load = () => Promise.all([
    fetch("/api/admin/classes").then(r => (r.ok ? r.json() : [])),
    fetch("/api/admin/staff").then(r => (r.ok ? r.json() : [])),
    fetch("/api/admin/rooms").then(r => (r.ok ? r.json() : [])),
  ]).then(([t, s, r]) => { setTypes(t); setStaff((s as Opt[]).map(x => ({ id: x.id, name: x.name }))); setRooms(r); }).catch(() => setTypes([]));
  useEffect(() => { void load(); }, []);

  async function save(c: ClassType) {
    const body = JSON.stringify({ ...c, schedules: c.schedules });
    const r = c.id
      ? await fetch(`/api/admin/classes/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body })
      : await fetch("/api/admin/classes", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!r.ok) { alert((await r.json().catch(() => ({})))?.error || "לא נשמר"); return; }
    setEditing(null);
    await load();
  }
  async function remove(c: ClassType) {
    if (!c.id || !confirm(`להפסיק את "${c.name}"? מפגשים עתידיים בלי נרשמים יימחקו; מפגשים שיש בהם נרשמים יישארו (אפשר לבטל אותם בלוח השיעורים).`)) return;
    await fetch(`/api/admin/classes/${c.id}`, { method: "DELETE" });
    setEditing(null);
    await load();
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">🧘 שיעורים קבוצתיים</h1>
          <p className="text-neutral-500 text-sm mt-1 max-w-xl">כל שיעור עם מקומות, מחיר ומערכת שעות. המערכת פותחת את המפגשים לשבועות הקרובים, ובזמן השיעור {v.staffDef} {v.staffFem ? "חסומה" : "חסום"} לתורים רגילים.</p>
        </div>
        <Link href="/admin/classes" className="text-sm font-semibold text-teal-700 border border-teal-200 rounded-xl px-3 py-2">ללוח השיעורים ←</Link>
      </div>
      {types === null ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-3 max-w-xl">
          {types.map(t => editing === t.id
            ? <Editor key={t.id} value={t} staff={staff} rooms={rooms} onSave={save} onCancel={() => setEditing(null)} onDelete={() => void remove(t)} />
            : (
              <div key={t.id} className="bg-white rounded-2xl border border-neutral-200 p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-neutral-900">{t.name}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">{t.durationMinutes} דק׳ · {t.capacity} מקומות{t.price ? ` · ₪${t.price}` : ""}{t.staffId ? ` · ${staff.find(s => s.id === t.staffId)?.name ?? ""}` : ""}</p>
                  <p className="text-xs text-neutral-400 mt-1">{t.schedules.map(r => `${DAYS[r.dayOfWeek]} ${r.startTime}`).join(" · ") || "אין עדיין שעות"}</p>
                </div>
                <button type="button" onClick={() => setEditing(t.id!)} className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded-lg border border-neutral-200">✏️ עריכה</button>
              </div>
            ))}
          {editing === "new"
            ? <Editor value={blank()} staff={staff} rooms={rooms} onSave={save} onCancel={() => setEditing(null)} />
            : <button type="button" onClick={() => setEditing("new")} className="w-full bg-white rounded-2xl border border-dashed border-neutral-300 p-4 text-sm font-semibold text-teal-700">+ שיעור חדש</button>}
        </div>
      )}
    </div>
  );
}
