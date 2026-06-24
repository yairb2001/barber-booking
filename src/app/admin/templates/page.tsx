"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TEMPLATE_DEFS, type TemplateKey } from "@/lib/messaging";

// ── Sample-data generator for the live preview ───────────────────────────────
// Renders a realistic-looking message so the admin can see how their template
// will appear before sending it to a real customer.
function applyPreview(template: string): string {
  const sample: Record<string, string> = {
    name:           "אבי", // first name only — matches what {{name}} sends in real messages
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
    delay_minutes:  "15",
    booking_link:   "https://dominant.co.il/book",
    cancel_link:    "https://dominant.co.il/book/my-appointments",
    cancel_line:    "לצפייה או ביטול תור:\nhttps://dominant.co.il/book/my-appointments",
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => sample[k] ?? `{{${k}}}`);
}

// ── Feature flags (stored as JSON on Business.features) ───────────────────────
type Features = { reminders?: boolean; reminder_24h?: boolean; reminder_2h?: boolean; agent?: boolean };
type FeatureFlag = "reminders" | "reminder_24h" | "reminder_2h";

// Defaults match hasFeature() in src/lib/messaging: reminders + 24h on, 2h off.
function readFeature(f: Features, flag: FeatureFlag): boolean {
  if (flag === "reminders")    return f.reminders ?? true;
  if (flag === "reminder_24h") return f.reminder_24h ?? f.reminders ?? true;
  if (flag === "reminder_2h")  return f.reminder_2h ?? false;
  return true;
}

// ── Per-message UI metadata — drives grouping, the on/off toggle, and the
//    "when is this sent?" explainer. This is what unifies editing + enabling. ──
type MsgMeta = {
  emoji: string;
  when: string;                 // human explanation of when the message fires
  toggle?: FeatureFlag;         // which feature flag turns it on/off (omit = always sent)
  variantOf?: TemplateKey;      // a variant that follows its parent's toggle
};

const MSG_META: Record<TemplateKey, MsgMeta> = {
  confirmation:           { emoji: "✅", when: "נשלחת מיד כשנקבע תור (מהאתר או מהאדמין)", toggle: "reminders" },
  reminder_24h:           { emoji: "🔔", when: "נשלחת יום לפני התור, ב-10:00 בבוקר", toggle: "reminder_24h" },
  reminder_24h_new:       { emoji: "🌟", when: "נשלחת אוטומטית במקום התזכורת הרגילה — ללקוח בביקור הראשון שלו", variantOf: "reminder_24h" },
  reminder_24h_returning: { emoji: "🎁", when: "נשלחת אוטומטית במקום התזכורת הרגילה — בביקור השני (קידום חכם)", variantOf: "reminder_24h" },
  reminder_2h:            { emoji: "⏰", when: "נשלחת כשעתיים לפני התור", toggle: "reminder_2h" },
  first_booking:          { emoji: "👋", when: "ברכה חמה ללקוח בהזמנה הראשונה שלו" },
  walk_in:                { emoji: "🚶", when: "תודה שנשלחת אחרי ביקור ספונטני (Walk-in)" },
  swap_proposal:          { emoji: "🔄", when: "נשלחת ללקוח כשמציעים לו החלפת תור" },
  move_proposal:          { emoji: "↗️", when: "נשלחת ללקוח כשמציעים לו לעבור לשעה ריקה" },
  swap_confirmation:      { emoji: "🤝", when: "נשלחת ללקוח כשהחלפת התור מאושרת" },
  appointment_moved:      { emoji: "📅", when: "נשלחת ללקוח כשמזיזים את התור שלו ביומן" },
  delay_notification:     { emoji: "⏳", when: "נשלחת ללקוח כשמודיעים לו על עיכוב" },
};

// Display order, grouped into sections.
const GROUPS: { title: string; subtitle: string; keys: TemplateKey[] }[] = [
  {
    title: "אישור ותזכורות",
    subtitle: "ההודעות הבסיסיות סביב התור — הפעל/כבה וערוך כל אחת",
    keys: ["confirmation", "reminder_24h", "reminder_24h_new", "reminder_24h_returning", "reminder_2h"],
  },
  {
    title: "ברכות אחרי ביקור",
    subtitle: "הודעות שמחזקות את הקשר עם הלקוח",
    keys: ["first_booking", "walk_in"],
  },
  {
    title: "החלפות והעברות תורים",
    subtitle: "נשלחות אוטומטית כשאתה מבצע פעולה ביומן",
    keys: ["swap_proposal", "move_proposal", "swap_confirmation", "appointment_moved", "delay_notification"],
  },
];

type EditorState = {
  value: string;          // current text in textarea
  initialValue: string;   // last-saved value (to detect dirty)
  saving: boolean;
  saved: boolean;
};

export default function MessagesHubPage() {
  const keys = Object.keys(TEMPLATE_DEFS) as TemplateKey[];

  const [byKey, setByKey] = useState<Record<TemplateKey, EditorState>>(() => {
    const init: Partial<Record<TemplateKey, EditorState>> = {};
    for (const k of keys) init[k] = { value: "", initialValue: "", saving: false, saved: false };
    return init as Record<TemplateKey, EditorState>;
  });
  const [features, setFeatures] = useState<Features>({});
  const [savingFlag, setSavingFlag] = useState<FeatureFlag | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState<TemplateKey | null>(null);
  const textareaRefs = useRef<Record<TemplateKey, HTMLTextAreaElement | null>>({} as Record<TemplateKey, HTMLTextAreaElement | null>);

  // Load all templates + feature flags from /api/admin/business
  useEffect(() => {
    fetch("/api/admin/business")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setLoading(false); return; }
        try {
          setFeatures(typeof data.features === "string" ? JSON.parse(data.features) : (data.features || {}));
        } catch { setFeatures({}); }
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

  // Toggle a feature flag — saved immediately (optimistic) so on/off lives
  // right next to the message text.
  async function toggleFeature(flag: FeatureFlag) {
    const next = { ...features, [flag]: !readFeature(features, flag) };
    setFeatures(next);
    setSavingFlag(flag);
    try {
      await fetch("/api/admin/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: next }),
      });
    } catch { /* keep optimistic state */ }
    setSavingFlag(null);
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
    setTimeout(() => setByKey(prev => ({ ...prev, [k]: { ...prev[k], saved: false } })), 2000);
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
    if (!ta) { setVal(k, cur.value + `{{${varKey}}}`); return; }
    const start = ta.selectionStart ?? cur.value.length;
    const end = ta.selectionEnd ?? cur.value.length;
    const next = cur.value.slice(0, start) + `{{${varKey}}}` + cur.value.slice(end);
    setVal(k, next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + `{{${varKey}}}`.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  if (loading) {
    return <div className="p-6 text-sm text-neutral-500">טוען הודעות...</div>;
  }

  // Render a single message card (toggle + when + editor + preview).
  function renderCard(k: TemplateKey) {
    const def = TEMPLATE_DEFS[k];
    const meta = MSG_META[k];
    const state = byKey[k];
    const isDirty = state.value !== state.initialValue;
    const isDefault = state.value === def.default;

    // Enablement: an explicit toggle, a variant that follows its parent, or
    // "always sent" (action-triggered).
    const hasToggle = !!meta.toggle;
    const enabled = meta.toggle
      ? readFeature(features, meta.toggle)
      : meta.variantOf
        ? readFeature(features, MSG_META[meta.variantOf].toggle!)
        : true;

    return (
      <div key={k} className={`bg-white rounded-2xl border overflow-hidden transition ${enabled ? "border-neutral-200" : "border-neutral-100 opacity-75"}`}>
        {/* Header: emoji + title + when + toggle */}
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start gap-3">
          <span className="text-2xl leading-none mt-0.5">{meta.emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-bold text-neutral-900 text-base">{def.label}</h2>
              {state.saved && <span className="text-[11px] text-emerald-700 font-semibold">✓ נשמר</span>}
              {!isDefault && !isDirty && <span className="text-[10px] text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded-full">מותאם</span>}
            </div>
            <p className="text-[12px] text-neutral-500 mt-0.5 leading-relaxed">{meta.when}</p>
            {meta.variantOf && (
              <p className="text-[11px] text-teal-600 mt-1">
                פעילה כש&quot;{TEMPLATE_DEFS[meta.variantOf].label}&quot; מופעלת
              </p>
            )}
          </div>
          {/* On/off toggle — only for messages with their own flag */}
          {hasToggle ? (
            <button
              onClick={() => toggleFeature(meta.toggle!)}
              disabled={savingFlag === meta.toggle}
              title={enabled ? "פעיל — לחץ לכיבוי" : "כבוי — לחץ להפעלה"}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 mt-1 ${enabled ? "bg-emerald-500" : "bg-neutral-300"} disabled:opacity-60`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${enabled ? "right-0.5" : "left-0.5"}`} />
            </button>
          ) : (
            <span className="text-[10px] text-neutral-400 bg-neutral-100 px-2 py-1 rounded-full shrink-0 mt-1 whitespace-nowrap">אוטומטי</span>
          )}
        </div>

        {/* Variables */}
        <div className="px-5 py-3 bg-slate-50/50 border-b border-slate-100">
          <p className="text-[11px] text-neutral-500 mb-2">משתנים זמינים — לחץ להוספה:</p>
          <div className="flex flex-wrap gap-1.5">
            {def.variables.map(v => (
              <button key={v.key} type="button" onClick={() => insertVar(k, v.key)}
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
            rows={7}
            dir="rtl"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 font-mono leading-relaxed resize-y"
            placeholder={def.default}
          />
          <p className="text-[10px] text-neutral-400 mt-1">{state.value.length} תווים</p>
        </div>

        {/* Actions */}
        <div className="px-5 py-3 border-t border-neutral-100 bg-neutral-50/60 flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setShowPreview(showPreview === k ? null : k)}
            className="text-xs text-neutral-700 hover:text-neutral-900 underline underline-offset-2">
            {showPreview === k ? "סגור תצוגה מקדימה" : "👁 תצוגה מקדימה"}
          </button>
          <div className="flex-1" />
          {!isDefault && (
            <button type="button" onClick={() => resetToDefault(k)}
              className="text-xs text-neutral-500 hover:text-red-600 transition">
              ↺ איפוס לברירת מחדל
            </button>
          )}
          <button type="button" onClick={() => saveTemplate(k)} disabled={!isDirty || state.saving}
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
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6" dir="rtl">
      <Link href="/admin/settings" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 transition-colors">
        → הגדרות עסק
      </Link>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5">
        <h1 className="text-xl font-bold text-neutral-900 mb-1">💬 הודעות ללקוחות</h1>
        <p className="text-sm text-neutral-600 leading-relaxed">
          כל ההודעות שהמערכת שולחת ללקוחות — במקום אחד. לכל הודעה: הפעלה/כיבוי, עריכת הטקסט, ותצוגה מקדימה.
          השתמש ב-<code className="bg-neutral-100 px-1 rounded text-slate-700 font-mono">{"{{משתנה}}"}</code> כדי להחליף ערכים דינמיים — לחץ על משתנה כדי להוסיף אותו במיקום הסמן.
        </p>
      </div>

      {/* Grouped message cards */}
      {GROUPS.map(group => (
        <div key={group.title} className="space-y-3">
          <div className="px-1">
            <h2 className="text-sm font-bold text-neutral-700">{group.title}</h2>
            <p className="text-[12px] text-neutral-400">{group.subtitle}</p>
          </div>
          {group.keys.map(renderCard)}
        </div>
      ))}
    </div>
  );
}
