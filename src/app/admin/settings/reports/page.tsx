"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  REPORT_DEFAULTS,
  REPORT_KINDS,
  resolveReportsConfig,
  type ReportKind,
  type ReportsConfig,
} from "@/lib/messaging/reports-config";

const META: Record<ReportKind, { icon: string; title: string; when: string; ownerDesc: string; staffDesc: string }> = {
  daily: {
    icon: "🌙",
    title: "סיכום יומי",
    when: "כל ערב בסוף היום",
    ownerDesc: "כמה לקוחות, מחזור, תפוסה, פירוט פר ספר ומה צפוי מחר",
    staffDesc: "כל ספר מקבל את המספרים שלו בלבד מהיום",
  },
  weekly: {
    icon: "📅",
    title: "סיכום שבועי",
    when: "כל יום ראשון בבוקר",
    ownerDesc: "השבוע מול השבוע שעבר — תורים, מחזור, תפוסה ולקוחות חדשים",
    staffDesc: "כל ספר מקבל את השבוע שלו, כולל אחוז לקוחות חוזרים",
  },
  monthly: {
    icon: "📈",
    title: "סיכום חודשי",
    when: "ב-1 בכל חודש",
    ownerDesc: "החודש שעבר מול קודמיו, שירותים מובילים ולקוחות שאבדו/חזרו",
    staffDesc: "כל ספר מקבל את החודש שלו",
  },
};

export default function ReportsSettingsPage() {
  const [cfg, setCfg] = useState<ReportsConfig>(REPORT_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [previewOf, setPreviewOf] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ body: string; sampleStaff?: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business").then(r => r.json()).then(biz => {
      // The API hands back settings already parsed; resolveReportsConfig wants
      // the raw JSON string, so re-stringify rather than duplicating defaults.
      setCfg(resolveReportsConfig(biz?.settings ? JSON.stringify(biz.settings) : null));
      setLoading(false);
    });
  }, []);

  async function setAudience(kind: ReportKind, who: "owner" | "staff", value: boolean) {
    const next: ReportsConfig = { ...cfg, [kind]: { ...cfg[kind], [who]: value } };
    setCfg(next);
    setSaving(true);
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settingsPatch: { reports: next } }),
    });
    setSaving(false);
  }

  async function showPreview(kind: ReportKind, scope: "owner" | "staff") {
    const key = `${kind}:${scope}`;
    if (previewOf === key) { setPreviewOf(null); setPreview(null); return; }
    setPreviewOf(key);
    setPreview(null);
    setPreviewLoading(true);
    const res = await fetch(`/api/admin/reports/preview?kind=${kind}&scope=${scope}`);
    const data = await res.json();
    setPreviewLoading(false);
    setPreview(res.ok ? data : { body: data.error || "שגיאה בבניית התצוגה" });
  }

  return (
    <div className="p-6 sm:p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">📊 דוחות</h1>
        <p className="text-neutral-500 text-sm mt-1">אילו סיכומים נשלחים בוואטסאפ, ולמי</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-4 max-w-2xl">
          {REPORT_KINDS.map(kind => {
            const m = META[kind];
            const c = cfg[kind];
            const off = !c.owner && !c.staff;
            return (
              <section key={kind} className={`bg-white border rounded-2xl overflow-hidden transition ${off ? "border-neutral-200 opacity-70" : "border-neutral-200"}`}>
                <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-neutral-100">
                  <span className="text-xl shrink-0">{m.icon}</span>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-neutral-800">{m.title}</h2>
                    <p className="text-xs text-neutral-400 mt-0.5">{m.when}</p>
                  </div>
                  {off && <span className="mr-auto text-[11px] text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded-full shrink-0">כבוי</span>}
                </div>

                <div className="p-3 space-y-2">
                  {([
                    { who: "owner" as const, label: "אליי", desc: m.ownerDesc },
                    { who: "staff" as const, label: "לכל ספר — המספרים שלו", desc: m.staffDesc },
                  ]).map(row => (
                    <div key={row.who} className="bg-neutral-50/70 rounded-xl px-3.5 py-3">
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => setAudience(kind, row.who, !c[row.who])}
                          disabled={saving}
                          className={`relative w-10 h-5 rounded-full transition-colors shrink-0 mt-0.5 disabled:opacity-50 ${c[row.who] ? "bg-teal-600" : "bg-neutral-300"}`}>
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${c[row.who] ? "right-0.5" : "left-0.5"}`} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-neutral-800">{row.label}</p>
                          <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">{row.desc}</p>
                        </div>
                        <button
                          onClick={() => showPreview(kind, row.who)}
                          className="text-[11px] text-teal-600 hover:text-teal-700 hover:underline shrink-0 mt-0.5">
                          {previewOf === `${kind}:${row.who}` ? "סגור" : "הצג דוגמה"}
                        </button>
                      </div>

                      {previewOf === `${kind}:${row.who}` && (
                        <div className="mt-3 pt-3 border-t border-neutral-200">
                          {previewLoading ? (
                            <p className="text-xs text-neutral-400">בונה תצוגה מהנתונים האמיתיים…</p>
                          ) : (
                            <>
                              {preview?.sampleStaff && (
                                <p className="text-[11px] text-neutral-400 mb-2">דוגמה עבור {preview.sampleStaff}</p>
                              )}
                              <pre className="text-xs text-neutral-700 bg-white border border-neutral-200 rounded-lg p-3 whitespace-pre-wrap font-sans leading-relaxed overflow-x-auto">
                                {preview?.body}
                              </pre>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          <p className="text-xs text-neutral-400 leading-relaxed px-1">
            הדוחות נשלחים בוואטסאפ מהמספר של העסק. &quot;אליי&quot; נשלח למספר העסק ולטלפון הכניסה שלך
            {" "}(אם הם שונים) — את טלפון הכניסה מגדירים במסך{" "}
            <Link href="/admin/settings/access" className="text-teal-600 hover:underline">גישה ואבטחה</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
