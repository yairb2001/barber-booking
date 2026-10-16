"use client";

import { useState } from "react";

/**
 * Examples of how the owner writes, without exporting chats (16.10.2026): take
 * them from his own replies to customers, or answer three short questions.
 * Every pick becomes a line in styleSamples (the agent copies the voice, not
 * the content).
 */
const QUICK = ["יש תור היום?", "כמה עולה תספורת?", "אני מאחר ב-10 דקות"];

export default function StyleHelper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [found, setFound] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState<string[]>(["", "", ""]);
  const lines = value.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const addMany = (ts: string[]) => { const next = [...lines]; for (const t of ts) { const x = t.trim(); if (x && !next.includes(x)) next.push(x); } onChange(next.join("\n")); };
  const add = (t: string) => addMany([t]);

  return (
    <div className="mt-2 rounded-xl bg-neutral-50 border border-neutral-200 p-3 space-y-2.5">
      <p className="text-[11px] text-neutral-500">אין צורך לייצא שיחות. אפשר לקחת מהתשובות שלך ללקוחות, או לענות כאן על שלוש שאלות.</p>
      <div>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await fetch("/api/admin/agent/style-samples").then(x => (x.ok ? x.json() : null)).catch(() => null); setBusy(false); setFound(r?.samples ?? []); }}
          className="text-xs font-semibold rounded-lg border border-teal-300 text-teal-800 bg-white px-3 py-1.5 disabled:opacity-50">{busy ? "מחפש…" : "קח מהתשובות שלי ללקוחות"}</button>
        {found && found.length === 0 && <p className="text-[11px] text-neutral-500 mt-1">עוד אין מספיק תשובות שלך ללקוחות. ענה על השאלות למטה.</p>}
        {found && found.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {found.map(t => (
              <li key={t} className="flex items-start gap-2 text-xs">
                <button type="button" disabled={lines.includes(t)} onClick={() => add(t)} className="shrink-0 rounded-md border border-neutral-300 bg-white px-1.5 disabled:opacity-40">{lines.includes(t) ? "✓" : "+"}</button>
                <span className="text-neutral-700">{t}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-neutral-600">איך היית עונה ללקוח שכותב:</p>
        {QUICK.map((q, i) => (
          <div key={q} className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-neutral-500 w-[120px]">״{q}״</span>
            <input value={quick[i]} onChange={e => setQuick(a => a.map((x, j) => (j === i ? e.target.value : x)))} placeholder="התשובה שלך" className="flex-1 min-w-0 border border-neutral-200 rounded-lg px-2 py-1.5 text-xs bg-white" />
          </div>
        ))}
        <button type="button" disabled={!quick.some(x => x.trim())} onClick={() => { addMany(quick); setQuick(["", "", ""]); }} className="text-xs font-semibold rounded-lg bg-teal-700 text-white px-3 py-1.5 disabled:opacity-40">הוסף לדוגמאות</button>
      </div>
    </div>
  );
}
