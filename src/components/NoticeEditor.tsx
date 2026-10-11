"use client";

import { useCallback, useEffect, useState } from "react";
import { NoticePopup, type NoticeItem } from "@/components/BookingNotice";

/**
 * Settings for the booking flow's "הודעה חשובה" popups (src/lib/booking-notice.ts).
 * The owner sees the general notice and every barber's, and approves what a
 * barber asked to publish; a barber sees his own, and a new text waits for
 * the owner (11.10.2026). Free text, shown to customers exactly as written.
 */
type Pending = { text: string; on: boolean; at: string };
type Row = { id: string; name: string; avatarUrl: string | null; text: string; on: boolean; pending: Pending | null };
type Data = { isOwner: boolean; general?: { text: string; on: boolean }; staff: Row[] };
const MAX = 600;

function Box({ title, hint, avatarUrl, text, on, onText, onOn, onPreview, children }: { title: string; hint: string; avatarUrl?: string | null; text: string; on: boolean; onText: (t: string) => void; onOn: (v: boolean) => void; onPreview: () => void; children?: React.ReactNode }) {
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
      {children}
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
  const [saved, setSaved] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [preview, setPreview] = useState<NoticeItem[] | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/notices", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) { setError("לא הצלחתי לטעון"); return; }
    const j = await r.json() as Data;
    // A barber keeps editing his own proposal while it waits.
    if (!j.isOwner) j.staff = j.staff.map(row => (row.pending ? { ...row, text: row.pending.text, on: row.pending.on } : row));
    setD(j);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!d) return <p className="text-sm text-neutral-400">טוען...</p>;

  const setRow = (id: string, patch: Partial<Row>) => { setSaved(null); setD({ ...d, staff: d.staff.map(r => (r.id === id ? { ...r, ...patch } : r)) }); };
  async function save() {
    setSaving(true); setSaved(null); setError(null);
    const r = await fetch("/api/admin/notices", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ general: d!.isOwner ? d!.general : undefined, staff: d!.staff.map(s => ({ id: s.id, text: s.text, on: s.on })) }) });
    setSaving(false);
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "השמירה נכשלה"); return; }
    const j = await r.json().catch(() => ({}));
    setSaved(j.pending ? "נשלח למנהל לאישור. הלקוחות יראו את ההודעה אחרי שהוא יאשר." : "נשמר. מהרגע הזה הלקוחות רואים את זה.");
    await load();
  }
  async function decide(staffId: string, action: "approve" | "reject") {
    setDeciding(staffId + action);
    const r = await fetch("/api/admin/notices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, staffId }) });
    setDeciding(null);
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error || "לא עבר, נסה שוב"); return; }
    setSaved(action === "approve" ? "ההודעה אושרה ועלתה ללקוחות." : "ההודעה נדחתה. הספר קיבל על זה התראה.");
    await load();
  }

  const waiting = d.isOwner ? d.staff.filter(r => r.pending) : [];
  return (
    <div className="space-y-4">
      {waiting.length > 0 && (
        <p className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          {waiting.length === 1 ? `הודעה אחת מחכה לאישור שלך (${waiting[0].name})` : `${waiting.length} הודעות מחכות לאישור שלך`}
        </p>
      )}
      {d.isOwner && d.general && (
        <Box title="הודעה כללית לכל הלקוחות" hint="קופצת כשלקוח מגיע למסך בחירת הספר. מי שקובע ישר מתור מהיר בדף הבית יראה אותה במסך האישור."
          text={d.general.text} on={d.general.on}
          onText={t => { setSaved(null); setD({ ...d, general: { ...d.general!, text: t } }); }}
          onOn={v => { setSaved(null); setD({ ...d, general: { ...d.general!, on: v } }); }}
          onPreview={() => setPreview([{ key: "g", title: "הודעה מהמספרה", text: d.general!.text }])} />
      )}
      {d.isOwner && d.staff.length > 0 && <h2 className="text-sm font-semibold text-neutral-700 pt-2">הודעה של כל ספר</h2>}
      {d.staff.map(r => (
        <Box key={r.id} title={d.isOwner ? r.name : "ההודעה שלי ללקוחות"} avatarUrl={r.avatarUrl}
          hint={d.isOwner ? "קופצת כשלקוח בוחר בספר הזה, או במסך האישור אם קבע ישר מתור מהיר" : "קופצת כשלקוח בוחר בך, או במסך האישור אם קבע ישר מתור מהיר. הודעה חדשה עוברת קודם לאישור המנהל."}
          text={r.text} on={r.on} onText={t => setRow(r.id, { text: t })} onOn={v => setRow(r.id, { on: v })}
          onPreview={() => setPreview([{ key: r.id, title: `הודעה מ${r.name}`, text: r.text, avatarUrl: r.avatarUrl }])}>
          {d.isOwner && r.pending && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
              <p className="text-xs font-semibold text-amber-800">{r.name} מבקש לפרסם:</p>
              <p className="text-sm text-neutral-800 mt-1.5 whitespace-pre-line break-words">{r.pending.text}</p>
              <div className="flex gap-2 mt-3">
                <button type="button" disabled={!!deciding} onClick={() => void decide(r.id, "approve")} className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold disabled:opacity-50">{deciding === r.id + "approve" ? "..." : "אשר ופרסם"}</button>
                <button type="button" disabled={!!deciding} onClick={() => void decide(r.id, "reject")} className="px-4 py-2 rounded-lg border border-neutral-300 text-neutral-700 text-sm disabled:opacity-50">{deciding === r.id + "reject" ? "..." : "לא מאשר"}</button>
                <button type="button" onClick={() => setPreview([{ key: r.id + "p", title: `הודעה מ${r.name}`, text: r.pending!.text, avatarUrl: r.avatarUrl }])} className="text-sm text-teal-700 ms-auto">תצוגה</button>
              </div>
            </div>
          )}
          {!d.isOwner && r.pending && (
            <p className="mt-3 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">ממתין לאישור המנהל. עד שהוא יאשר, הלקוחות לא רואים את הנוסח החדש.</p>
          )}
        </Box>
      ))}
      <div className="flex items-center gap-3 sticky bottom-3">
        <button type="button" onClick={() => void save()} disabled={saving} className="px-6 py-3 rounded-xl bg-teal-600 text-white font-semibold shadow-md hover:bg-teal-700 disabled:opacity-50">{saving ? "שומר..." : d.isOwner ? "שמירה" : "שליחה"}</button>
        {saved && <span className="text-sm text-teal-700">{saved}</span>}
      </div>
      <p className="text-xs text-neutral-500">כל הודעה מופיעה ללקוח פעם אחת בכל ביקור. אם משנים את הטקסט, היא תופיע שוב גם למי שכבר ראה.{!d.isOwner && " כיבוי ההודעה נכנס מיד, בלי אישור."}</p>
      {preview && <NoticePopup items={preview} onDone={() => setPreview(null)} />}
    </div>
  );
}
