"use client";

import { useEffect, useRef, useState } from "react";
import { TEMPLATE_DEFS, type TemplateKey } from "@/lib/messaging";

// ── Sample-data generator for the live preview ───────────────────────────────
// Renders a realistic-looking message so the admin can see how their template
// will appear before sending it to a real customer.
function applyPreview(template: string): string {
  const sample: Record<string, string> = {
    name:           "אבי כהן",
    business:       "DOMINANT",
    date:           "ראשון, 5 במאי",
    time:           "14:30",
    end_time:       "15:00",
    staff:          "אוריה",
    service:        "תספורת + זקן",
    price:          "90",
    address_line:   "\n📍 דרך השלום 12, ראשון לציון",
    current_date:   "ראשון, 5 במאי",
    current_time:   "14:30",
    proposed_date:  "שני, 6 במאי",
    proposed_time:  "16:00",
    proposed_staff: "יאיר הרוש",
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => sample[k] ?? `{{${k}}}`);
}

type TemplateEditorState = {
  value: string;          // current text in textarea
  initialValue: string;   // last-saved value (to detect dirty)
  saving: boolean;
  saved: boolean;
};

export default function TemplatesPage() {
  const keys = Object.keys(TEMPLATE_DEFS) as TemplateKey[];
  const [byKey, setByKey] = useState<Record<TemplateKey, TemplateEditorState>>(() => {
    const init: Partial<Record<TemplateKey, TemplateEditorState>> = {};
    for (const k of keys) {
      init[k] = { value: "", initialValue: "", saving: false, saved: false };
    }
    return init as Record<TemplateKey, TemplateEditorState>;
  });
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState<TemplateKey | null>(null);
  const textareaRefs = useRef<Record<TemplateKey, HTMLTextAreaElement | null>>({} as Record<TemplateKey, HTMLTextAreaElement | null>);

  // Load all current templates from /api/admin/business
  useEffect(() => {
    fetch("/api/admin/business")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setLoading(false); return; }
        setByKey(prev => {
          const next = { ...prev };
          for (const k of keys) {
            const def = TEMPLATE_DEFS[k];
            const stored: string | null = data[def.field] ?? null;
            const value = stored ?? def.default;
            next[k] = { value, initialValue: value, saving: false, saved: false };
          }
          return next;
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setVal(k: TemplateKey, v: string) {
    setByKey(prev => ({ ...prev, [k]: { ...prev[k], value: v, saved: false } }));
  }

  async function saveTemplate(k: TemplateKey) {
    const def = TEMPLATE_DEFS[k];
    const cur = byKey[k];
    setByKey(prev => ({ ...prev, [k]: { ...prev[k], saving: true, saved: false } }));
    // If user reset to default, send null so the server uses the built-in
    const valueToSend = cur.value === def.default ? null : cur.value;
    const res = await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [def.field]: valueToSend }),
    });
    if (!res.ok) {
      alert("שגיאה בשמירה");
      setByKey(prev => ({ ...prev, [k]: { ...prev[k], saving: false } }));
      return;
    }
    setByKey(prev => ({ ...prev, [k]: { ...prev[k], saving: false, saved: true, initialValue: cur.value } }));
    setTimeout(() => {
      setByKey(prev => ({ ...prev, [k]: { ...prev[k], saved: false } }));
    }, 2000);
  }

  function resetToDefault(k: TemplateKey) {
    const def = TEMPLATE_DEFS[k];
    if (!confirm("לאפס לתבנית ברירת המחדל? השינויים שלך יאבדו.")) return;
    setByKey(prev => ({ ...prev, [k]: { ...prev[k], value: def.default, saved: false } }));
  }

  /** Insert {{var}} at the textarea's cursor position. */
  function insertVar(k: TemplateKey, varKey: string) {
    const ta = textareaRefs.current[k];
    const cur = byKey[k];
    if (!ta) {
      setVal(k, cur.value + `{{${varKey}}}`);
      return;
    }
    const start = ta.selectionStart ?? cur.value.length;
    const end = ta.selectionEnd ?? cur.value.length;
    const next = cur.value.slice(0, start) + `{{${varKey}}}` + cur.value.slice(end);
    setVal(k, next);
    // Restore caret position right after the inserted token
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + `{{${varKey}}}`.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  if (loading) {
    return <div className="p-6 text-sm text-neutral-500">טוען תבניות...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4" dir="rtl">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5">
        <h1 className="text-xl font-bold text-neutral-900 mb-1">📝 תבניות הודעות</h1>
        <p className="text-sm text-neutral-600 leading-relaxed">
          ערוך את כל ההודעות שהמערכת שולחת ללקוחות. השתמש ב-<code className="bg-neutral-100 px-1 rounded text-slate-700 font-mono">{"{{משתנה}}"}</code> כדי להחליף ערכים דינמיים — לחץ על משתנה כדי להוסיף אותו במיקום הסמן.
        </p>
      </div>

      {/* Per-template editors */}
      {(Object.keys(TEMPLATE_DEFS) as TemplateKey[]).map(k => {
        const def = TEMPLATE_DEFS[k];
        const state = byKey[k];
        const isDirty = state.value !== state.initialValue;
        const isDefault = state.value === def.default;
        return (
          <div key={k} className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
            {/* Title row */}
            <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-neutral-900 text-base">{def.label}</h2>
                <p className="text-[12px] text-neutral-500 mt-0.5 leading-relaxed">{def.description}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {state.saved && <span className="text-[11px] text-emerald-700 font-semibold">✓ נשמר</span>}
                {!isDefault && !isDirty && <span className="text-[10px] text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded-full">מותאם</span>}
              </div>
            </div>

            {/* Variables row */}
            <div className="px-5 py-3 bg-slate-50/50 border-b border-slate-100">
              <p className="text-[11px] text-neutral-500 mb-2">משתנים זמינים — לחץ להוספה:</p>
              <div className="flex flex-wrap gap-1.5">
                {def.variables.map(v => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => insertVar(k, v.key)}
                    className="text-[11px] bg-white hover:bg-slate-100 border border-slate-200 text-slate-900 rounded-full px-2.5 py-1 font-mono transition"
                    title={v.label}>
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Editor */}
            <div className="px-5 py-3">
              <textarea
                ref={el => { textareaRefs.current[k] = el; }}
                value={state.value}
                onChange={e => setVal(k, e.target.value)}
                rows={8}
                dir="rtl"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 font-mono leading-relaxed resize-y"
                placeholder={def.default}
              />
              <p className="text-[10px] text-neutral-400 mt-1">
                {state.value.length} תווים · עברית רגילה (לא נדרש דקדוק מיוחד)
              </p>
            </div>

            {/* Actions */}
            <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/60 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setShowPreview(showPreview === k ? null : k)}
                className="text-xs text-neutral-700 hover:text-neutral-900 underline underline-offset-2">
                {showPreview === k ? "סגור תצוגה מקדימה" : "👁 תצוגה מקדימה"}
              </button>
              <div className="flex-1" />
              {!isDefault && (
                <button
                  type="button"
                  onClick={() => resetToDefault(k)}
                  className="text-xs text-neutral-500 hover:text-red-600 transition">
                  ↺ איפוס לברירת מחדל
                </button>
              )}
              <button
                type="button"
                onClick={() => saveTemplate(k)}
                disabled={!isDirty || state.saving}
                className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition">
                {state.saving ? "שומר..." : "שמור"}
              </button>
            </div>

            {/* Preview */}
            {showPreview === k && (
              <div className="px-5 py-4 border-t border-neutral-100 bg-emerald-50/40">
                <p className="text-[11px] text-emerald-800 font-semibold mb-2">תצוגה מקדימה (עם נתונים לדוגמה):</p>
                <div className="bg-white rounded-xl border border-emerald-200 p-3 whitespace-pre-line text-sm leading-relaxed text-neutral-800 shadow-sm">
                  {applyPreview(state.value)}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
