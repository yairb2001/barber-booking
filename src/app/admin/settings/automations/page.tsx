"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type AutoType = "reengage" | "post_first_visit" | "post_every_visit";
interface AutoRec {
  id: string; type: AutoType; name: string; active: boolean;
  settings: string; template: string | null;
}
const AUTO_NAMES: Record<AutoType, string> = {
  reengage: "החזרת לקוחות לא פעילים",
  post_first_visit: "קידום חכם — לקוח חדש",
  post_every_visit: "קידום חכם — לקוח חוזר",
};
const AUTO_DEFAULT_SETTINGS: Record<AutoType, object> = {
  reengage:         { inactiveWeeks: 6, excludeWithFutureAppt: true, segment: "all" },
  post_first_visit: { ctaType: "google_review", ctaUrl: "", delayMinutes: 30 },
  post_every_visit: { segment: "regular_only", minVisits: 2, ctaType: "google_review", ctaUrl: "", delayMinutes: 60 },
};
function parseAutoS<T>(s: string): T { try { return JSON.parse(s) as T; } catch { return {} as T; } }

// ── Automations sub-panels ─────────────────────────────────────────────────────

function ReengagePanelSettings({
  settings, saving, onSave,
}: {
  settings: Record<string, unknown>;
  saving: boolean;
  onSave: (s: object) => void;
}) {
  const [weeks,   setWeeks]   = useState((settings.inactiveWeeks as number)          ?? 6);
  const [exclude, setExclude] = useState((settings.excludeWithFutureAppt as boolean) ?? true);
  const [segment, setSegment] = useState((settings.segment as string)                ?? "all");
  const [dirty,   setDirty]   = useState(false);
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-neutral-500 block mb-1">שלח אחרי כמה שבועות ללא ביקור</label>
        <div className="flex items-center gap-3">
          <input type="range" min={2} max={24} value={weeks}
            onChange={e => { setWeeks(Number(e.target.value)); setDirty(true); }}
            className="flex-1 accent-slate-900" />
          <span className="text-slate-800 font-bold text-sm w-24 text-center">{weeks} שבועות</span>
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={exclude}
          onChange={e => { setExclude(e.target.checked); setDirty(true); }}
          className="accent-emerald-500" />
        <span className="text-sm text-neutral-600">אל תשלח ללקוחות עם תור עתידי</span>
      </label>
      <div>
        <label className="text-xs text-neutral-500 block mb-1.5">למי לשלח</label>
        <div className="flex gap-2">
          {([["all","כולם"],["new_only","חדשים בלבד"],["regular_only","קבועים בלבד"]] as [string,string][]).map(([v,l]) => (
            <button key={v} onClick={() => { setSegment(v); setDirty(true); }}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${segment === v ? "border-teal-600 bg-slate-50 text-slate-700" : "border-neutral-200 text-neutral-500 hover:border-slate-300"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {dirty && (
        <button onClick={() => { onSave({ inactiveWeeks: weeks, excludeWithFutureAppt: exclude, segment }); setDirty(false); }}
          disabled={saving}
          className="text-xs bg-teal-600 text-white px-4 py-1.5 rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50">
          {saving ? "שומר..." : "שמור הגדרות"}
        </button>
      )}
    </div>
  );
}

function PostFirstPanelSettings({
  settings, saving, onSave,
}: {
  settings: Record<string, unknown>;
  saving: boolean;
  onSave: (s: object) => void;
}) {
  const [ctaType, setCtaType] = useState((settings.ctaType as string) ?? "google_review");
  const [ctaUrl,  setCtaUrl]  = useState((settings.ctaUrl  as string) ?? "");
  const [delayMinutes, setDelayMinutes] = useState((settings.delayMinutes as number) ?? 30);
  const [dirty,   setDirty]   = useState(false);
  const CTA_OPTIONS = [
    { value: "google_review", label: "⭐ גוגל",      placeholder: "https://g.page/r/..." },
    { value: "instagram",     label: "📸 אינסטגרם", placeholder: "https://instagram.com/..." },
    { value: "custom",        label: "🔗 מותאם",    placeholder: "https://..." },
  ];
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-neutral-500 block mb-1.5">השהייה אחרי סיום התור</label>
        <div className="flex items-center gap-3">
          <input type="number" min={0} max={1440} value={delayMinutes}
            onChange={e => { setDelayMinutes(Number(e.target.value)); setDirty(true); }}
            className="w-24 border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          <span className="text-sm text-neutral-500">דקות</span>
        </div>
        <p className="text-[10px] text-neutral-400 mt-1">ההודעה תישלח לאחר {delayMinutes} דקות מסיום התור</p>
      </div>
      <div>
        <label className="text-xs text-neutral-500 block mb-1.5">קריאה לפעולה (CTA)</label>
        <div className="flex gap-2">
          {CTA_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => { setCtaType(opt.value); setDirty(true); }}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${ctaType === opt.value ? "border-teal-600 bg-slate-50 text-slate-700" : "border-neutral-200 text-neutral-500 hover:border-slate-300"}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-neutral-500 block mb-1">קישור</label>
        <input type="url" value={ctaUrl} dir="ltr"
          onChange={e => { setCtaUrl(e.target.value); setDirty(true); }}
          placeholder={CTA_OPTIONS.find(o => o.value === ctaType)?.placeholder}
          className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
      </div>
      {dirty && (
        <button onClick={() => { onSave({ ctaType, ctaUrl, delayMinutes }); setDirty(false); }}
          disabled={saving}
          className="text-xs bg-teal-600 text-white px-4 py-1.5 rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50">
          {saving ? "שומר..." : "שמור הגדרות"}
        </button>
      )}
    </div>
  );
}

function PostEveryPanelSettings({
  settings, saving, onSave,
}: {
  settings: Record<string, unknown>;
  saving: boolean;
  onSave: (s: object) => void;
}) {
  const [segment,      setSegment]      = useState((settings.segment      as string) ?? "regular_only");
  const [minVisits,    setMinVisits]    = useState((settings.minVisits    as number) ?? 2);
  const [exactVisit,   setExactVisit]   = useState((settings.exactVisit   as number) ?? 2);
  const [delayMinutes, setDelayMinutes] = useState((settings.delayMinutes as number) ?? 60);
  const [ctaType,      setCtaType]      = useState((settings.ctaType      as string) ?? "google_review");
  const [ctaUrl,       setCtaUrl]       = useState((settings.ctaUrl       as string) ?? "");
  const [dirty,        setDirty]        = useState(false);
  const CTA_OPTIONS = [
    { value: "google_review", label: "⭐ גוגל",      placeholder: "https://g.page/r/..." },
    { value: "instagram",     label: "📸 אינסטגרם", placeholder: "https://instagram.com/..." },
    { value: "custom",        label: "🔗 מותאם",    placeholder: "https://..." },
  ];
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-neutral-500 block mb-1.5">השהייה אחרי סיום התור</label>
        <div className="flex items-center gap-3">
          <input type="number" min={0} max={1440} value={delayMinutes}
            onChange={e => { setDelayMinutes(Number(e.target.value)); setDirty(true); }}
            className="w-24 border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          <span className="text-sm text-neutral-500">דקות</span>
        </div>
        <p className="text-[10px] text-neutral-400 mt-1">ההודעה תישלח לאחר {delayMinutes} דקות מסיום התור</p>
      </div>
      <div>
        <label className="text-xs text-neutral-500 block mb-1.5">למי לשלח</label>
        <div className="flex gap-2">
          {([["all","כולם"],["regular_only","חוזרים בלבד"],["exact_visit","ביקור מסוים"],["new_only","חדשים בלבד"]] as [string,string][]).map(([v,l]) => (
            <button key={v} onClick={() => { setSegment(v); setDirty(true); }}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${segment === v ? "border-teal-600 bg-slate-50 text-slate-700" : "border-neutral-200 text-neutral-500 hover:border-slate-300"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {segment === "regular_only" && (
        <div>
          <label className="text-xs text-neutral-500 block mb-1">מינימום ביקורים לשליחה</label>
          <div className="flex items-center gap-3">
            <input type="range" min={2} max={10} value={minVisits}
              onChange={e => { setMinVisits(Number(e.target.value)); setDirty(true); }}
              className="flex-1 accent-slate-900" />
            <span className="text-slate-800 font-bold text-sm w-12 text-center">{minVisits}+</span>
          </div>
        </div>
      )}
      {segment === "exact_visit" && (
        <div>
          <label className="text-xs text-neutral-500 block mb-1">תישלח רק אחרי ביקור מספר</label>
          <div className="flex items-center gap-3">
            <input type="range" min={2} max={10} value={exactVisit}
              onChange={e => { setExactVisit(Number(e.target.value)); setDirty(true); }}
              className="flex-1 accent-slate-900" />
            <span className="text-slate-800 font-bold text-sm w-12 text-center">#{exactVisit}</span>
          </div>
          <p className="text-[10px] text-neutral-400 mt-1">ההודעה תישלח פעם אחת בלבד — אחרי הביקור ה-{exactVisit} של הלקוח.</p>
        </div>
      )}
      <div>
        <label className="text-xs text-neutral-500 block mb-1.5">קריאה לפעולה (CTA)</label>
        <div className="flex gap-2">
          {CTA_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => { setCtaType(opt.value); setDirty(true); }}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${ctaType === opt.value ? "border-teal-600 bg-slate-50 text-slate-700" : "border-neutral-200 text-neutral-500 hover:border-slate-300"}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-neutral-500 block mb-1">קישור</label>
        <input type="url" value={ctaUrl} dir="ltr"
          onChange={e => { setCtaUrl(e.target.value); setDirty(true); }}
          placeholder={CTA_OPTIONS.find(o => o.value === ctaType)?.placeholder}
          className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
      </div>
      {dirty && (
        <button onClick={() => { onSave({ segment, minVisits, exactVisit, delayMinutes, ctaType, ctaUrl }); setDirty(false); }}
          disabled={saving}
          className="text-xs bg-teal-600 text-white px-4 py-1.5 rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50">
          {saving ? "שומר..." : "שמור הגדרות"}
        </button>
      )}
    </div>
  );
}

// ── AutoPanel (shared light-themed card) ───────────────────────────────────────

function AutoPanel({
  emoji, title, subtitle, active, saving, onToggle, template, vars, defaultTemplate, onSave, onTest, children,
}: {
  emoji: string; title: string; subtitle: string;
  active: boolean; saving: boolean;
  onToggle: () => void;
  template: string | null; vars: string[]; defaultTemplate: string;
  onSave: (patch: Record<string, unknown>) => void;
  onTest?: () => void;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [localTpl,  setLocalTpl]  = useState(template ?? "");
  const [tplDirty,  setTplDirty]  = useState(false);
  const display = localTpl || defaultTemplate;

  return (
    <div className={`rounded-2xl border overflow-hidden transition ${active ? "border-neutral-200 bg-white" : "border-neutral-100 bg-neutral-50/60"}`}>
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="text-xl">{emoji}</span>
          <div>
            <p className={`text-sm font-semibold ${active ? "text-neutral-800" : "text-neutral-400"}`}>{title}</p>
            <p className="text-xs text-neutral-400 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <button onClick={onToggle} disabled={saving}
          className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${active ? "bg-emerald-500" : "bg-neutral-200"} disabled:opacity-50`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${active ? "right-0.5" : "left-0.5"}`} />
        </button>
      </div>

      {active && onTest && (
        <div className="px-5 pb-3 -mt-1">
          <button onClick={onTest}
            className="text-xs bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 px-3 py-1.5 rounded-lg font-semibold transition">
            🧪 שלח הודעת בדיקה
          </button>
        </div>
      )}

      {children && (
        <div className="px-5 pb-4 border-t border-neutral-100 pt-4 space-y-3">
          {children}
        </div>
      )}

      <div className="px-5 pb-4 border-t border-neutral-100 pt-3">
        <button onClick={() => setExpanded(x => !x)}
          className="text-xs text-neutral-500 hover:text-neutral-700 flex items-center gap-1.5 mb-2 transition">
          ✏️ ערוך תבנית הודעה
          <span className="text-[10px]">{expanded ? "▲" : "▼"}</span>
        </button>
        {expanded && (
          <div className="space-y-2">
            <textarea value={display}
              onChange={e => { setLocalTpl(e.target.value); setTplDirty(true); }}
              rows={5} dir="rtl"
              className="w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {vars.map(v => (
                <button key={v} onClick={() => { setLocalTpl(display + v); setTplDirty(true); }}
                  className="text-[11px] bg-neutral-100 hover:bg-neutral-200 text-neutral-600 px-2 py-0.5 rounded-md font-mono transition">
                  {v}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              {tplDirty && (
                <button onClick={() => { onSave({ template: localTpl || null }); setTplDirty(false); }}
                  disabled={saving}
                  className="text-xs bg-teal-600 text-white px-4 py-1.5 rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50">
                  {saving ? "שומר..." : "שמור תבנית"}
                </button>
              )}
              {localTpl && (
                <button onClick={() => { setLocalTpl(""); setTplDirty(true); }}
                  className="text-xs text-red-400 hover:text-red-600 transition">
                  ↺ ברירת מחדל
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AutomationsSettingsPage() {
  const [autos,   setAutos]   = useState<AutoRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState<AutoType | null>(null);
  const [toast,   setToast]   = useState("");

  useEffect(() => {
    fetch("/api/admin/automations").then(r => r.json())
      .then(d => { setAutos(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const get = (t: AutoType) => autos.find(a => a.type === t) ?? null;

  function showToast() {
    setToast("✅ נשמר בהצלחה");
    setTimeout(() => setToast(""), 2500);
  }

  async function upsert(type: AutoType, patch: Record<string, unknown>) {
    setSaving(type);
    let rec = get(type);
    if (!rec) {
      const created: AutoRec = await fetch("/api/admin/automations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name: AUTO_NAMES[type], active: false, settings: AUTO_DEFAULT_SETTINGS[type] }),
      }).then(r => r.json());
      setAutos(p => [...p, created]);
      rec = created;
    }
    const updated: AutoRec = await fetch(`/api/admin/automations/${rec.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(r => r.json());
    setAutos(p => p.map(a => a.id === updated.id ? updated : a));
    setSaving(null);
    showToast();
  }

  function toggle(type: AutoType) {
    const cur = get(type)?.active ?? false;
    setAutos(p => p.map(a => a.type === type ? { ...a, active: !cur } : a));
    if (!get(type)) {
      setAutos(p => [...p, { id: "__tmp__", type, name: AUTO_NAMES[type], active: true, settings: JSON.stringify(AUTO_DEFAULT_SETTINGS[type]), template: null }]);
    }
    upsert(type, { active: !cur });
  }

  async function testAutomation(type: AutoType) {
    const rec = get(type);
    if (!rec || rec.id === "__tmp__") {
      alert("יש לשמור את האוטומציה לפני שליחת בדיקה (הפעל ושמור הגדרות)");
      return;
    }
    const phone = prompt("הזן מספר טלפון לקבלת הודעת בדיקה (השאר ריק לשליחה למספר העסק):") ?? "";
    const res = await fetch(`/api/admin/automations/${rec.id}/test`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone.trim() || undefined }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      alert(`✓ נשלחה הודעת בדיקה ל-${data.sentTo}`);
    } else {
      alert(`✗ שגיאה: ${data.error || "שליחה נכשלה"}`);
    }
  }

  const reengage  = get("reengage");
  const postFirst = get("post_first_visit");
  const postEvery = get("post_every_visit");

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🤖 אוטומציות</h1>
        <p className="text-neutral-500 text-sm mt-1">החזרת לקוחות לא פעילים וקידום חכם אחרי ביקור</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-4 max-w-xl">
          {toast && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-900 border border-emerald-600 text-emerald-300 text-sm font-medium px-5 py-2.5 rounded-xl shadow-lg">
              {toast}
            </div>
          )}

          <p className="text-xs text-neutral-500">
            האוטומציות שולחות הודעות WhatsApp. ודא שהחיבור מוגדר בעמוד וואטסאפ.
          </p>

          <RhythmNudgeCard />

          <AutoPanel
            emoji="🔄" title="החזרת לקוחות לא פעילים"
            subtitle="שולח ללקוחות שלא ביקרו זמן רב — דורש cron יומי"
            active={reengage?.active ?? false}
            saving={saving === "reengage"}
            onToggle={() => toggle("reengage")}
            template={reengage?.template ?? null}
            vars={["{{name}}", "{{business}}", "{{booking_url}}"]}
            defaultTemplate={"שלום {{name}} 👋\n\nהתגעגענו אליך ב*{{business}}* ✂️\nבוא נקבע תור: {{booking_url}}"}
            onSave={patch => upsert("reengage", patch)}
            onTest={() => testAutomation("reengage")}
          >
            <ReengagePanelSettings
              settings={parseAutoS(reengage?.settings ?? "{}")}
              saving={saving === "reengage"}
              onSave={s => upsert("reengage", { settings: s })}
            />
          </AutoPanel>

          <AutoPanel
            emoji="🌟" title="קידום חכם — לקוח חדש"
            subtitle="נשלח אחרי הביקור הראשון — אוטומטי לפי שעת סיום התור"
            active={postFirst?.active ?? false}
            saving={saving === "post_first_visit"}
            onToggle={() => toggle("post_first_visit")}
            template={postFirst?.template ?? null}
            vars={["{{name}}", "{{business}}", "{{staff}}", "{{service}}", "{{cta}}"]}
            defaultTemplate={"שלום {{name}} 👋\n\nתודה שביקרת לראשונה ב*{{business}}* ✂️\nנשמח לראותך שוב! {{cta}}"}
            onSave={patch => upsert("post_first_visit", patch)}
            onTest={() => testAutomation("post_first_visit")}
          >
            <PostFirstPanelSettings
              settings={parseAutoS(postFirst?.settings ?? "{}")}
              saving={saving === "post_first_visit"}
              onSave={s => upsert("post_first_visit", { settings: s })}
            />
          </AutoPanel>

          <AutoPanel
            emoji="🌟" title="קידום חכם — לקוח חוזר"
            subtitle="נשלח אחרי ביקור חוזר — אוטומטי לפי שעת סיום התור"
            active={postEvery?.active ?? false}
            saving={saving === "post_every_visit"}
            onToggle={() => toggle("post_every_visit")}
            template={postEvery?.template ?? null}
            vars={["{{name}}", "{{business}}", "{{staff}}", "{{service}}", "{{cta}}"]}
            defaultTemplate={"שלום {{name}} 👋\n\nתודה שחזרת ל*{{business}}* ✂️\nנהנינו לטפל בך שוב 😊{{cta}}\n\nנתראה בפעם הבאה!"}
            onSave={patch => upsert("post_every_visit", patch)}
            onTest={() => testAutomation("post_every_visit")}
          >
            <PostEveryPanelSettings
              settings={parseAutoS(postEvery?.settings ?? "{}")}
              saving={saving === "post_every_visit"}
              onSave={s => upsert("post_every_visit", { settings: s })}
            />
          </AutoPanel>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs text-emerald-800">
            ✓ <strong>cron אוטומטי</strong> — החזרת לקוחות רץ יומית ב-11:00,
            אוטומציות אחרי ביקור נבדקות כל 15 דקות. כפתור 🧪 שולח הודעת בדיקה לטלפון שלך.
          </div>
        </div>
      )}
    </div>
  );
}


// ── "הגיע הזמן לתור" — rhythm nudge (specs/rhythm-nudge.md) ──────────────────
type RhythmCfg = { enabled: boolean; leadDays: number; earlyWindowDays: number; fillThreshold: number; secondNudge: boolean; includeNewCustomers: boolean; excludedStaffIds: string[]; notBefore: string | null };
const RHYTHM_DEFAULTS: RhythmCfg = { enabled: false, leadDays: 2, earlyWindowDays: 7, fillThreshold: 2, secondNudge: true, includeNewCustomers: false, excludedStaffIds: [], notBefore: null };

function RhythmNudgeCard() {
  const [cfg, setCfg] = useState<RhythmCfg>(RHYTHM_DEFAULTS);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<{ planned: { name: string; reason: string; body: string }[]; skipped: Record<string, number>; scanned: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/business").then(r => r.json()),
      fetch("/api/admin/staff").then(r => r.json()),
    ]).then(([biz, st]) => {
      const r = biz?.settings?.rhythmNudge || {};
      setCfg({ ...RHYTHM_DEFAULTS, ...r, excludedStaffIds: Array.isArray(r.excludedStaffIds) ? r.excludedStaffIds : [] });
      setStaff((Array.isArray(st) ? st : []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  async function save(next: RhythmCfg) {
    setCfg(next); setSaving(true);
    await fetch("/api/admin/business", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settingsPatch: { rhythmNudge: next } }) }).catch(() => {});
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 1800);
  }
  async function runPreview() {
    setPreviewing(true); setPreview(null);
    const r = await fetch("/api/admin/automations/rhythm-preview", { method: "POST" }).then(x => x.json()).catch(() => null);
    setPreview(r?.result ?? null); setPreviewing(false);
  }
  const num = (label: string, key: "leadDays" | "earlyWindowDays" | "fillThreshold", hint: string) => (
    <div>
      <label className="text-xs text-neutral-500 block mb-1">{label}</label>
      <input type="number" min={0} max={30} value={cfg[key]} onChange={e => setCfg(c => ({ ...c, [key]: Number(e.target.value) }))} onBlur={() => save(cfg)}
        className="w-20 border border-neutral-200 rounded-lg px-3 py-1.5 text-sm" dir="ltr" />
      <p className="text-[11px] text-neutral-400 mt-1">{hint}</p>
    </div>
  );
  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button onClick={onClick} disabled={saving} className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${on ? "bg-teal-500" : "bg-neutral-200"}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? "right-0.5" : "left-0.5"}`} />
    </button>
  );

  if (!loaded) return null;
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Toggle on={cfg.enabled} onClick={() => save({ ...cfg, enabled: !cfg.enabled })} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-neutral-800">✂️ הגיע הזמן לתור</h2>
          <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
            כל בוקר ב-10:00 (לא בשבת): לקוח שלפי הקצב שלו הגיע הזמן לתספורת ואין לו תור מקבל הודעה אחת עם 3 שעות פנויות אצל הספר הקבוע שלו, ושאלה מה נוח. תשובה חופשית מגיעה לסוכן. שליחה בפעימה של דקה.
          </p>
          {saved && <span className="text-xs text-emerald-600">✓ נשמר</span>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {num("ימים לפני היעד", "leadDays", "היעד = ביקור אחרון + הקצב שלו")}
        {num("לבדוק מוקדם מ-", "earlyWindowDays", "ימים לפני היעד — מתחילים לבדוק אם השעות שלו נתפסות")}
        {num("נשארו X או פחות", "fillThreshold", "שעות פנויות בטווח שלו ביום היעד → שולחים כבר היום")}
      </div>

      <div className="flex items-center gap-3">
        <Toggle on={cfg.secondNudge} onClick={() => save({ ...cfg, secondNudge: !cfg.secondNudge })} />
        <p className="text-sm text-neutral-700">הודעה שנייה אחרי 5 ימים אם לא ענה ולא קבע (ואז משחררים)</p>
      </div>
      <div className="flex items-center gap-3">
        <Toggle on={cfg.includeNewCustomers} onClick={() => save({ ...cfg, includeNewCustomers: !cfg.includeNewCustomers })} />
        <p className="text-sm text-neutral-700">גם לקוחות אחרי ביקור ראשון (פעם אחת, לפי הקצב הממוצע של המספרה)</p>
      </div>

      {staff.length > 1 && (
        <div>
          <p className="text-xs text-neutral-500 mb-1.5">לא לשלוח ללקוחות הקבועים של:</p>
          <div className="flex flex-wrap gap-1.5">
            {staff.map(s => {
              const off = cfg.excludedStaffIds.includes(s.id);
              return (
                <button key={s.id} onClick={() => save({ ...cfg, excludedStaffIds: off ? cfg.excludedStaffIds.filter(x => x !== s.id) : [...cfg.excludedStaffIds, s.id] })}
                  className={`px-2.5 py-1 rounded-full text-xs border ${off ? "bg-neutral-800 text-white border-neutral-800" : "bg-white text-neutral-600 border-neutral-200"}`}>
                  {off ? "⛔ " : ""}{s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs text-neutral-500 block mb-1">לא לשלוח לפני</label>
        <input type="date" value={cfg.notBefore || ""} onChange={e => save({ ...cfg, notBefore: e.target.value || null })}
          className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm" dir="ltr" />
        <p className="text-[11px] text-neutral-400 mt-1">מגן להפעלה ראשונה — ריק = מהיום.</p>
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-neutral-100">
        <button onClick={runPreview} disabled={previewing}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-teal-200 text-teal-700 hover:bg-teal-50 disabled:opacity-50">
          {previewing ? "מחשב…" : "👀 למי היה נשלח היום? (בלי לשלוח)"}
        </button>
        <a href="/admin/templates" className="text-xs text-neutral-500 underline underline-offset-2">עריכת הנוסחים</a>
      </div>
      {preview && (
        <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-3 text-xs space-y-2 max-h-80 overflow-y-auto">
          <p className="font-semibold text-neutral-700">{preview.planned.length} היו מקבלים היום (נסרקו {preview.scanned})</p>
          {preview.planned.slice(0, 40).map((p, i) => (
            <div key={i} className="bg-white border border-neutral-100 rounded-lg p-2">
              <p className="font-medium text-neutral-800">{p.name} <span className="text-neutral-400 font-normal" dir="ltr">· {p.reason}</span></p>
              <p className="text-neutral-600 whitespace-pre-line mt-1">{p.body}</p>
            </div>
          ))}
          <p className="text-neutral-400" dir="ltr">skipped: {Object.entries(preview.skipped).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
        </div>
      )}
    </div>
  );
}
