"use client";

import { useEffect, useState } from "react";
import { NoticePopup, type NoticeItem } from "@/components/BookingNotice";

/**
 * Settings for the booking flow's "הודעה חשובה" popups (src/lib/booking-notice.ts).
 * The owner sees the general notice and every barber's; a barber sees his own.
 * Free text, shown to customers exactly as written.
 */
type Row = { id: string; name: string; avatarUrl: string | null; text: string; on: boolean };
type Data = { isOwner: boolean; general?: { text: string; on: boolean }; staff: Row[] };
const MAX = 600;

function Box({ title, hint, avatarUrl, text, on, onText, onOn, onPreview }: { title: string; hint: string; avatarUrl?: string | null; text: string; on: boolean; onText: (t: string) => void; onOn: (v: boolean) => void; onPreview: () => void }) {
  return (
    <section className="bg-white rounded-2xl border border-neutral-200 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
          )}
          <div className="min-w-0">
            <h2 className="font-semibold text-neutral-800 truncate">{title}</h2>
            <p className="text-xs text-neutral-500 mt-0.5">{hint}</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-700 shrink-0 cursor-pointer">
          <input type="checkbox" checked={on} onChange={e => onOn(e.target.checked)} className="w-5 h-5 accent-teal-600" />
          פעיל
        </label>
      </div>
      <textarea value={text} onChange={e => onText(e.target.value.slice(0, MAX))} rows={4} placeholder="למשל: השבוע אני בחופשה עד יום חמישי. תורים מיום ראשון." className="mt-3 w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-400" />
      <div className="flex items-center justify-between mt-1.5 text-xs text-neutral-400">
        <button type="button" onClick={onPreview} disabled={!text.trim()} className="text-teal-700 font-medium disabled:opacity-40">איך הלקוח יראה את זה</button>
        <span className="tabular-nums">{text.length}/{MAX}</span>
      </div>
      {on && !text.trim() && <p className="text-xs text-amber-700 mt-1">ההודעה ריקה, אז היא לא תופיע.</p>}
    </section>
  );
}

export default function NoticeEditor() {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<NoticeItem[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/notices", { cache: "no-store" }).then(async r => {
      if (!r.ok) { setError("לא הצלחתי לטעון"); return; }
      setD(await r.json());
    }).catch(() => setError("לא הצלחתי לטעון"));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!d) return <p className="text-sm text-neutral-400">טוען...</p>;

  const setRow = (id: string, patch: Partial<Row>) => { setSaved(false); setD({ ...d, staff: d.staff.map(r => (r.id === id ? { ...r, ...patch } : r)) }); };
  async function save() {
    setSaving(true); setSaved(false);
    const r = await fetch("/api/admin/notices", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ general: d!.isOwner ? d!.general : undefined, staff: d!.staff.map(s => ({ id: s.id, text: s.text, on: s.on })) }) });
    setSaving(false);
    if (r.ok) setSaved(true); else setError((await r.json().catch(() => ({}))).error || "השמירה נכשלה");
  }

  return (
    <div className="space-y-4">
      {d.isOwner && d.general && (
        <Box title="הודעה כללית לכל הלקוחות" hint="קופצת כשלקוח מגיע למסך בחירת הספר. מי שקובע ישר מתור מהיר בדף הבית יראה אותה במסך האישור."
          text={d.general.text} on={d.general.on}
          onText={t => { setSaved(false); setD({ ...d, general: { ...d.general!, text: t } }); }}
          onOn={v => { setSaved(false); setD({ ...d, general: { ...d.general!, on: v } }); }}
          onPreview={() => setPreview([{ key: "g", title: "הודעה מהמספרה", text: d.general!.text }])} />
      )}
      {d.isOwner && d.staff.length > 0 && <h2 className="text-sm font-semibold text-neutral-700 pt-2">הודעה של כל ספר</h2>}
      {d.staff.map(r => (
        <Box key={r.id} title={d.isOwner ? r.name : "ההודעה שלי ללקוחות"} avatarUrl={r.avatarUrl}
          hint={d.isOwner ? "קופצת כשלקוח בוחר בספר הזה, או במסך האישור אם קבע ישר מתור מהיר" : "קופצת כשלקוח בוחר בך, או במסך האישור אם קבע ישר מתור מהיר"}
          text={r.text} on={r.on} onText={t => setRow(r.id, { text: t })} onOn={v => setRow(r.id, { on: v })}
          onPreview={() => setPreview([{ key: r.id, title: `הודעה מ${r.name}`, text: r.text, avatarUrl: r.avatarUrl }])} />
      ))}
      <div className="flex items-center gap-3 sticky bottom-3">
        <button type="button" onClick={() => void save()} disabled={saving} className="px-6 py-3 rounded-xl bg-teal-600 text-white font-semibold shadow-md hover:bg-teal-700 disabled:opacity-50">{saving ? "שומר..." : "שמירה"}</button>
        {saved && <span className="text-sm text-teal-700">נשמר. מהרגע הזה הלקוחות רואים את זה.</span>}
      </div>
      <p className="text-xs text-neutral-500">כל הודעה מופיעה ללקוח פעם אחת בכל ביקור. אם משנים את הטקסט, היא תופיע שוב גם למי שכבר ראה.</p>
      {preview && <NoticePopup items={preview} onDone={() => setPreview(null)} />}
    </div>
  );
}
