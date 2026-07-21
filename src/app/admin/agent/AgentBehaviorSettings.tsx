"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_GREETING_TEMPLATE,
  DEFAULT_NUDGE_TEMPLATE,
  DEFAULT_REGREET_DAYS,
} from "@/lib/link-first-defaults";

/**
 * Agent behaviour settings — lives on the AGENT page (not general settings).
 * Two self-contained cards, both persisted into Business.settings via
 * PATCH /api/admin/business:
 *   1. Link-first mode (token saver) — toggle + editable texts + re-greet window.
 *   2. Personal WhatsApp agent (owner commands) — master + owner-self switches.
 */
export default function AgentBehaviorSettings() {
  const [loading, setLoading] = useState(true);

  // Link-first
  const [linkFirstEnabled, setLinkFirstEnabled] = useState(false);
  const [greeting, setGreeting] = useState(DEFAULT_GREETING_TEMPLATE);
  const [nudge, setNudge] = useState(DEFAULT_NUDGE_TEMPLATE);
  const [regreetDays, setRegreetDays] = useState(DEFAULT_REGREET_DAYS);
  const [lfToggleSaving, setLfToggleSaving] = useState(false);
  const [lfTextsSaving, setLfTextsSaving] = useState(false);
  const [lfTextsSaved, setLfTextsSaved] = useState(false);

  // Owner agent
  const [ownerAgentEnabled, setOwnerAgentEnabled] = useState(false);
  const [ownerAgentSelfEnabled, setOwnerAgentSelfEnabled] = useState(true);
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [ownerSaved, setOwnerSaved] = useState(false);

  // Agent gateway — bearer token for an EXTERNAL agent (the owner's CEO bot).
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [gatewayToken, setGatewayToken] = useState("");   // shown ONCE right after generate
  const [gatewayBusy, setGatewayBusy] = useState(false);
  const [gatewayCopied, setGatewayCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const biz = await fetch("/api/admin/business").then((r) => r.json());
        const s = biz?.settings || {};
        setLinkFirstEnabled(s.linkFirstEnabled === true);
        if (typeof s.linkFirstGreeting === "string" && s.linkFirstGreeting.trim()) setGreeting(s.linkFirstGreeting);
        if (typeof s.linkNudgeText === "string" && s.linkNudgeText.trim()) setNudge(s.linkNudgeText);
        if (typeof s.linkFirstRegreetDays === "number") setRegreetDays(s.linkFirstRegreetDays);
        setOwnerAgentEnabled(s.ownerAgentEnabled === true);
        setOwnerAgentSelfEnabled(s.ownerAgentSelfDisabled !== true);
        const gw = await fetch("/api/admin/agent/gateway-token").then((r) => r.json());
        setGatewayEnabled(!!gw?.enabled);
      } catch { /* keep defaults */ } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Merge a patch into the CURRENT settings blob and persist (server replaces the
  // whole blob, so we must always send the full object).
  async function patchSettings(patch: Record<string, unknown>) {
    const biz = await fetch("/api/admin/business").then((r) => r.json());
    const current = biz?.settings || {};
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { ...current, ...patch } }),
    });
  }

  async function saveLinkFirstToggle(enabled: boolean) {
    setLfToggleSaving(true);
    await patchSettings({ linkFirstEnabled: enabled });
    setLfToggleSaving(false);
  }

  async function saveLinkFirstTexts() {
    setLfTextsSaving(true);
    setLfTextsSaved(false);
    const days = Number.isFinite(regreetDays) ? Math.max(0, Math.round(regreetDays)) : DEFAULT_REGREET_DAYS;
    await patchSettings({
      // Persist an override only when changed from the default (undefined → cleared).
      linkFirstGreeting: greeting.trim() === DEFAULT_GREETING_TEMPLATE.trim() ? undefined : greeting,
      linkNudgeText: nudge.trim() === DEFAULT_NUDGE_TEMPLATE.trim() ? undefined : nudge,
      linkFirstRegreetDays: days === DEFAULT_REGREET_DAYS ? undefined : days,
    });
    setLfTextsSaving(false);
    setLfTextsSaved(true);
    setTimeout(() => setLfTextsSaved(false), 2000);
  }

  async function saveOwnerAgent(next: { enabled?: boolean; selfEnabled?: boolean }) {
    setOwnerSaving(true);
    setOwnerSaved(false);
    const enabled = next.enabled ?? ownerAgentEnabled;
    const selfEnabled = next.selfEnabled ?? ownerAgentSelfEnabled;
    await patchSettings({ ownerAgentEnabled: enabled, ownerAgentSelfDisabled: !selfEnabled });
    setOwnerSaving(false);
    setOwnerSaved(true);
    setTimeout(() => setOwnerSaved(false), 2000);
  }

  async function generateGatewayToken() {
    setGatewayBusy(true);
    setGatewayCopied(false);
    try {
      const d = await fetch("/api/admin/agent/gateway-token", { method: "POST" }).then((r) => r.json());
      if (d?.token) { setGatewayToken(d.token); setGatewayEnabled(true); }
    } finally { setGatewayBusy(false); }
  }

  async function revokeGatewayToken() {
    if (!confirm("לבטל את המפתח? הסוכן החיצוני יאבד גישה מיידית עד שתיצור מפתח חדש.")) return;
    setGatewayBusy(true);
    try {
      await fetch("/api/admin/agent/gateway-token", { method: "DELETE" });
      setGatewayEnabled(false); setGatewayToken("");
    } finally { setGatewayBusy(false); }
  }

  async function copyGatewayToken() {
    try {
      await navigator.clipboard.writeText(gatewayToken);
      setGatewayCopied(true);
      setTimeout(() => setGatewayCopied(false), 2000);
    } catch { /* clipboard blocked — user can select manually */ }
  }

  if (loading) {
    return <div className="text-sm text-neutral-400 py-4">טוען הגדרות…</div>;
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── Link-first mode ── */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <label className="text-sm text-neutral-800 font-semibold block">🔗 מצב &quot;קישור קודם&quot; (חיסכון בטוקנים)</label>
            <p className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">
              בפנייה ראשונה של לקוח, במקום שהסוכן יענה — נשלחת אליו ברכה קבועה עם קישור לקביעת תור (בלי עלות).
              הסוכן נכנס לפעולה רק אם הלקוח מגיב. אחרי 30 דק&apos; בלי תגובה ובלי תור — נשלחת תזכורת קבועה אחת.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-200">
          <div>
            <p className="text-[13px] text-neutral-800 font-medium">הפעלה</p>
            <p className="text-[11px] text-neutral-500 mt-0.5">דורש שהסוכן החכם יהיה פעיל. ניתן לכבות בכל רגע.</p>
          </div>
          <button
            type="button"
            disabled={lfToggleSaving}
            onClick={() => { const v = !linkFirstEnabled; setLinkFirstEnabled(v); saveLinkFirstToggle(v); }}
            className={`w-12 h-6 rounded-full transition-colors relative shrink-0 disabled:opacity-50 ${linkFirstEnabled ? "bg-teal-500" : "bg-neutral-300"}`}
          >
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${linkFirstEnabled ? "right-1" : "right-6"}`} />
          </button>
        </div>

        {linkFirstEnabled && (
          <div className="mt-3 pt-3 border-t border-slate-200 space-y-3">
            <p className="text-[11px] text-neutral-500 leading-relaxed">
              עריכת ההודעות. השאר את <code className="bg-neutral-200 rounded px-1">{"{{link}}"}</code> במקום שבו יופיע הקישור.
              אפשר גם <code className="bg-neutral-200 rounded px-1">{"{{name}}"}</code> לשם הלקוח (אם אין שם — יוסר אוטומטית).
            </p>
            <div>
              <label className="text-[12px] text-neutral-700 font-medium block mb-1">ברכה ראשונה (עם הקישור)</label>
              <textarea
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                rows={4}
                dir="rtl"
                className="w-full text-[13px] rounded-lg border border-neutral-300 bg-white p-2.5 focus:outline-none focus:border-teal-500 resize-y"
              />
            </div>
            <div>
              <label className="text-[12px] text-neutral-700 font-medium block mb-1">תזכורת אחרי 30 דק&apos; (חתירה למגע)</label>
              <textarea
                value={nudge}
                onChange={(e) => setNudge(e.target.value)}
                rows={3}
                dir="rtl"
                className="w-full text-[13px] rounded-lg border border-neutral-300 bg-white p-2.5 focus:outline-none focus:border-teal-500 resize-y"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[12px] text-neutral-700 font-medium">שלח שוב ברכה אחרי</label>
              <input
                type="number"
                min={0}
                max={60}
                value={regreetDays}
                onChange={(e) => setRegreetDays(parseInt(e.target.value || "0", 10))}
                dir="ltr"
                className="w-16 text-[13px] text-center rounded-lg border border-neutral-300 bg-white p-2 focus:outline-none focus:border-teal-500"
              />
              <label className="text-[12px] text-neutral-700 font-medium">ימים בלי קשר</label>
            </div>
            <p className="text-[11px] text-neutral-500 leading-relaxed">
              לקוח שכותב שוב בתוך החלון הזה יגיע ישר לסוכן (בלי ברכה חוזרת). ערך קטן יותר = יותר חיסכון בטוקנים; גדול יותר = חוויה חמה יותר ללקוחות חוזרים.
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={lfTextsSaving}
                onClick={saveLinkFirstTexts}
                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[13px] font-semibold transition disabled:opacity-50"
              >
                {lfTextsSaving ? "שומר..." : "שמור הודעות"}
              </button>
              <button
                type="button"
                disabled={lfTextsSaving}
                onClick={() => { setGreeting(DEFAULT_GREETING_TEMPLATE); setNudge(DEFAULT_NUDGE_TEMPLATE); setRegreetDays(DEFAULT_REGREET_DAYS); }}
                className="text-[12px] text-neutral-500 hover:text-neutral-700 transition"
              >
                שחזר ברירת מחדל
              </button>
              {lfTextsSaved && <span className="text-[11px] text-green-700 font-semibold">✓ נשמר</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── Personal WhatsApp agent (owner commands) ── */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <label className="text-sm text-neutral-800 font-semibold block">🤖 סוכן אישי בוואטסאפ</label>
            <p className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">
              מאפשר לשלוח פקודות ניהול לסוכן ישירות בוואטסאפ — להזיז ולהחליף תורים, לבטל,
              לקבוע ללקוח, ולשלוח הודעה לכל לקוחות היום. סמכות מלאה, ללא אישור לקוח.
            </p>
          </div>
          {ownerSaved && <span className="text-[11px] text-green-700 font-semibold shrink-0">✓ נשמר</span>}
        </div>

        <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-200">
          <div>
            <p className="text-[13px] text-neutral-800 font-medium">הפעלה כללית</p>
            <p className="text-[11px] text-neutral-500 mt-0.5">כיבוי כאן מבטל את הסוכן האישי לכולם — גם לך וגם למנהלי המשנה.</p>
          </div>
          <button
            type="button"
            disabled={ownerSaving}
            onClick={() => { const v = !ownerAgentEnabled; setOwnerAgentEnabled(v); saveOwnerAgent({ enabled: v }); }}
            className={`w-12 h-6 rounded-full transition-colors relative shrink-0 disabled:opacity-50 ${ownerAgentEnabled ? "bg-teal-500" : "bg-neutral-300"}`}
          >
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${ownerAgentEnabled ? "right-1" : "right-6"}`} />
          </button>
        </div>

        <div className={`flex items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-200 ${ownerAgentEnabled ? "" : "opacity-40 pointer-events-none"}`}>
          <div>
            <p className="text-[13px] text-neutral-800 font-medium">הפעלה עבורי</p>
            <p className="text-[11px] text-neutral-500 mt-0.5">כיבוי כאן מבטל את הסוכן עבורך בלבד; מנהלי משנה עם הרשאה ימשיכו להשתמש.</p>
          </div>
          <button
            type="button"
            disabled={ownerSaving || !ownerAgentEnabled}
            onClick={() => { const v = !ownerAgentSelfEnabled; setOwnerAgentSelfEnabled(v); saveOwnerAgent({ selfEnabled: v }); }}
            className={`w-12 h-6 rounded-full transition-colors relative shrink-0 disabled:opacity-50 ${ownerAgentSelfEnabled ? "bg-teal-500" : "bg-neutral-300"}`}
          >
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${ownerAgentSelfEnabled ? "right-1" : "right-6"}`} />
          </button>
        </div>

        <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[12px] text-neutral-700">👥 הרשאה למנהלי משנה (פר ספר)</span>
          <a href="/admin/staff" className="text-[12px] font-semibold text-slate-700 hover:text-slate-900 underline underline-offset-2">
            ניהול גישות ←
          </a>
        </div>
      </div>

      {/* ── Agent gateway (external CEO bot) ── */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <label className="text-sm text-neutral-800 font-semibold block">🔑 חיבור לסוכן חיצוני (המנכ&quot;ל)</label>
            <p className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">
              מפתח שמאפשר לסוכן ה-AI שלך בשרת אחר (למשל בוט טלגרם) לשלוט בעסק דרך API — לראות לוח, לקבוע,
              להזיז ולהחליף תורים, לבטל, לחפש לקוח, ולשלוח דיוור. אותם כלים כמו הסוכן האישי, סמכות מלאה על כל העסק.
            </p>
          </div>
          <span className={`text-[11px] font-semibold shrink-0 ${gatewayEnabled ? "text-green-700" : "text-neutral-400"}`}>
            {gatewayEnabled ? "● פעיל" : "○ כבוי"}
          </span>
        </div>

        {/* Freshly-generated token — shown ONCE, never retrievable again */}
        {gatewayToken && (
          <div className="mt-3 pt-3 border-t border-slate-200">
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 leading-relaxed">
              ⚠️ העתק את המפתח עכשיו ושמור אותו במקום בטוח — לא נוכל להציג אותו שוב. מי שמחזיק בו שולט בעסק.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code dir="ltr" className="flex-1 text-[11px] bg-neutral-900 text-emerald-300 rounded-lg px-2.5 py-2 overflow-x-auto whitespace-nowrap select-all">
                {gatewayToken}
              </code>
              <button
                type="button"
                onClick={copyGatewayToken}
                className="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[12px] font-semibold transition shrink-0"
              >
                {gatewayCopied ? "✓ הועתק" : "העתק"}
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-slate-200 flex items-center gap-3">
          <button
            type="button"
            disabled={gatewayBusy}
            onClick={generateGatewayToken}
            className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[13px] font-semibold transition disabled:opacity-50"
          >
            {gatewayBusy ? "..." : gatewayEnabled ? "צור מפתח חדש (מבטל את הקודם)" : "צור מפתח"}
          </button>
          {gatewayEnabled && (
            <button
              type="button"
              disabled={gatewayBusy}
              onClick={revokeGatewayToken}
              className="text-[12px] text-red-500 hover:text-red-700 transition disabled:opacity-50"
            >
              בטל מפתח
            </button>
          )}
        </div>

        <p className="text-[10px] text-neutral-500 mt-2 leading-relaxed">
          שימוש: הסוכן שולח בקשות ל-<code dir="ltr" className="bg-neutral-200 rounded px-1">POST /api/agent/gateway</code> עם הכותרת{" "}
          <code dir="ltr" className="bg-neutral-200 rounded px-1">Authorization: Bearer &lt;המפתח&gt;</code>.
          בקשת <code dir="ltr" className="bg-neutral-200 rounded px-1">GET</code> לאותה כתובת מחזירה את רשימת הכלים הזמינים.
        </p>
      </div>
    </div>
  );
}
