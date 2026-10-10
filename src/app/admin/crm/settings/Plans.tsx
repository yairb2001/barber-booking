"use client";

import { useEffect, useState } from "react";
import { C, NUM, Btn, crmAction } from "../ui";

/** Plans editor (10.10.2026): sold by appointments; messages and the AI budget are the safety quotas. */
type Plan = { key: string; name: string; apptsCap: number; messages: number; aiBudgetIls: number; priceIls: number };
export type PackSettings = { packMessagesQty: number; packMessagesPrice: number; packAiIls: number; packAiPrice: number; packMarketingQty: number; packMarketingPrice: number };

const COLS: [keyof Plan, string][] = [["apptsCap", "מתאים לכ־X תורים"], ["messages", "הודעות"], ["aiBudgetIls", "סוכן (₪ עלות)"], ["priceIls", "מחיר ₪"]];
const PACKS: [keyof PackSettings, keyof PackSettings, string, string][] = [
  ["packMessagesQty", "packMessagesPrice", "חבילת הודעות", "הודעות"],
  ["packAiIls", "packAiPrice", "חבילת סוכן", "₪ עלות"],
  ["packMarketingQty", "packMarketingPrice", "חבילת שיווק", "הודעות"],
];

export function PlansEditor({ plans, packs, onSaved }: { plans: Plan[]; packs: PackSettings; onSaved: () => void }) {
  const [rows, setRows] = useState<Plan[]>(plans);
  const [p, setP] = useState<PackSettings>(packs);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { setRows(plans); }, [plans]);
  useEffect(() => { setP(packs); }, [packs]);
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

  async function save() {
    setBusy(true); setNote(null);
    const a = await crmAction({ action: "plans.save", plans: rows });
    const b = await crmAction({ action: "settings.update", ...p });
    setBusy(false); setNote(a.ok && b.ok ? "נשמר" : (a.error || b.error || "שגיאה"));
    if (a.ok && b.ok) onSaved();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={r.key} className="rounded-xl p-3 flex flex-col gap-2" style={{ background: C.ground }}>
            <input value={r.name} onChange={e => setRows(x => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} className="h-10 rounded-lg px-2 text-sm font-bold" style={{ border: "1px solid #C7D8D5" }} aria-label="שם המסלול" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {COLS.map(([k, label]) => (
                <label key={k} className="flex flex-col gap-1 text-[11px]" style={{ color: C.muted }}>{label}
                  <input type="number" min={0} value={r[k] as number} onChange={e => setRows(x => x.map((y, j) => (j === i ? { ...y, [k]: num(e.target.value) } : y)))} className="h-10 rounded-lg px-2 text-sm text-slate-900" style={{ ...NUM, border: "1px solid #C7D8D5" }} />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">חבילות תוספת (פי 3 מהעלות)</span>
        {PACKS.map(([q, pr, label, unit]) => (
          <div key={q} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24" style={{ color: C.muted }}>{label}</span>
            <input type="number" min={0} value={p[q]} onChange={e => setP(x => ({ ...x, [q]: num(e.target.value) }))} className="h-10 w-24 rounded-lg px-2" style={{ ...NUM, border: "1px solid #C7D8D5" }} aria-label={`${label} כמות`} />
            <span style={{ color: C.muted }}>{unit} ב־</span>
            <input type="number" min={0} value={p[pr]} onChange={e => setP(x => ({ ...x, [pr]: num(e.target.value) }))} className="h-10 w-20 rounded-lg px-2" style={{ ...NUM, border: "1px solid #C7D8D5" }} aria-label={`${label} מחיר`} />
            <span style={{ color: C.muted }}>₪</span>
          </div>
        ))}
      </div>
      <p className="m-0 text-xs" style={{ color: C.muted }}>המגבלה היא רק הודעות וואטסאפ. התורים הם הערכה שמוצגת בהרשמה, לא תקרה. הסוכן נמדד מאחורי הקלעים. אין הודעות שיווק באף מסלול, רק בחבילה.</p>
      <div className="flex items-center gap-3">
        <Btn kind="dark" disabled={busy} onClick={save}>{busy ? "שומר…" : "שמור מסלולים"}</Btn>
        {note && <span className="text-sm" style={{ color: C.petrol }}>{note}</span>}
      </div>
    </div>
  );
}
