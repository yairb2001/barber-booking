"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { tierHas } from "@/lib/tier";
import { useWhatsAppQr, WhatsAppQrBody } from "@/components/WhatsAppQrPanel";

// ── QR re-connect ────────────────────────────────────────────────────────────
// Live GreenAPI linking: polls the instance state and, when the WhatsApp number
// is disconnected, shows a fresh QR (rotates ~20s) so the owner can re-scan from
// inside the app instead of opening the GreenAPI console. Shares its polling +
// rendering with the global reconnect banner modal — see WhatsAppQrPanel.
function QrConnect() {
  const [open, setOpen] = useState(false);
  const { data, loading } = useWhatsAppQr(open);

  if (!open) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200 p-6">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">🔗</span>
          <h2 className="font-semibold text-neutral-800">חיבור מהיר / חיבור מחדש</h2>
        </div>
        <p className="text-xs text-neutral-500 mb-4 leading-relaxed">
          אם ה-WhatsApp התנתק — לחצו כאן, סרקו את ה-QR מתוך אפליקציית ה-WhatsApp במכשיר העסק,
          והחיבור יחזור מיד. אין צורך להיכנס לאתר של GreenAPI.
        </p>
        <button onClick={() => setOpen(true)}
          className="bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold transition">
          בדיקת חיבור / הצגת QR
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔗</span>
          <h2 className="font-semibold text-neutral-800">חיבור WhatsApp</h2>
        </div>
        <button onClick={() => setOpen(false)}
          className="text-xs text-neutral-400 hover:text-neutral-600">סגור</button>
      </div>
      <WhatsAppQrBody data={data} loading={loading} errorHint="ודאו ש-Instance ID ו-API Token נכונים ושמורים." />
    </div>
  );
}

export default function WhatsAppSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState("basic");
  const [whatsappStatus, setWhatsappStatus] = useState("not_requested");
  const [requesting, setRequesting] = useState(false);

  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [messagingProvider, setMessagingProvider] = useState("green_api");
  const [greenApiInstanceId, setGreenApiInstanceId] = useState("");
  const [greenApiToken, setGreenApiToken] = useState("");
  const [chatsEnabled, setChatsEnabled] = useState(false);
  const [whatsappPrefill, setWhatsappPrefill] = useState("");
  const [whatsappBubbleEnabled, setWhatsappBubbleEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/business").then(r => r.json()).then(data => {
      if (data) {
        setWhatsappNumber(data.whatsappNumber || "");
        setMessagingProvider(data.messagingProvider || "green_api");
        setGreenApiInstanceId(data.greenApiInstanceId || "");
        setGreenApiToken(data.greenApiToken || "");
        setChatsEnabled(data.chatsEnabled ?? false);
        setTestPhone(data.phone || "");
        const s = data.settings || {};
        if (typeof s.whatsappPrefill === "string") setWhatsappPrefill(s.whatsappPrefill);
        setWhatsappBubbleEnabled(s.whatsappBubbleEnabled !== false);
      }
      setLoading(false);
    });
    fetch("/api/admin/me").then(r => r.json()).then(me => {
      if (me?.tier) setTier(me.tier);
      if (me?.whatsappStatus) setWhatsappStatus(me.whatsappStatus);
    }).catch(() => {});
  }, []);

  async function requestWhatsapp() {
    setRequesting(true);
    try {
      const res = await fetch("/api/admin/request-whatsapp", { method: "POST" });
      const data = await res.json();
      if (data?.whatsappStatus) setWhatsappStatus(data.whatsappStatus);
    } catch { /* ignore — best effort */ }
    setRequesting(false);
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/messaging/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: testPhone }),
      });
      const data = await res.json();
      setTestResult({ ok: !!data.ok, error: data.error });
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : "error" });
    }
    setTesting(false);
  }

  async function save() {
    setSaving(true);
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        whatsappNumber, messagingProvider, greenApiInstanceId, greenApiToken, chatsEnabled,
        settingsPatch: { whatsappPrefill: whatsappPrefill.trim(), whatsappBubbleEnabled },
      }),
    });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  const canOwnWhatsapp = tierHas(tier, "ownWhatsapp");
  const configured = !!(greenApiInstanceId && greenApiToken);

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">💬 וואטסאפ</h1>
        <p className="text-neutral-500 text-sm mt-1">חיבור, הודעת פתיחה, שיחות ובדיקת שליחה</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-5 max-w-xl">
          {whatsappStatus !== "connected" && (
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">📲</span>
                <h2 className="font-semibold text-neutral-800">חיבור WhatsApp למספר העסק</h2>
              </div>
              <p className="text-xs text-neutral-500 mb-4 leading-relaxed">
                שליחת תזכורות ואישורים אוטומטיים מהמספר של העסק היא חלק ממסלול הפרימיום.
                לאחר אישור הבקשה נחבר עבורך את המספר — עד אז המערכת ממשיכה לקבל תורים כרגיל.
              </p>
              {whatsappStatus === "requested" ? (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 font-medium">
                  ⏳ בקשתך נשלחה — נחבר את ה-WhatsApp בקרוב.
                </div>
              ) : (
                <button onClick={requestWhatsapp} disabled={requesting}
                  className="bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-5 py-2.5 text-sm font-semibold transition disabled:opacity-50">
                  {requesting ? "שולח..." : "חבר/י WhatsApp"}
                </button>
              )}
            </div>
          )}

          {canOwnWhatsapp && (
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-neutral-800">חיבור WhatsApp</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full ${configured ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                  {configured ? "✓ מחובר" : "לא מוגדר"}
                </span>
              </div>
              <p className="text-xs text-neutral-500 mb-4">
                הזן את פרטי ה-Green API של המספר העסקי. ההודעות (תזכורות, אישורים) יישלחו ממספר זה.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">ספק הודעות</label>
                  <select value={messagingProvider} onChange={e => setMessagingProvider(e.target.value)}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm">
                    <option value="green_api">Green API (לא רשמי)</option>
                    <option value="none" disabled>Meta Cloud (רשמי — בקרוב)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">מספר WhatsApp של העסק</label>
                  <input value={whatsappNumber} onChange={e => setWhatsappNumber(e.target.value)}
                    dir="ltr" placeholder="972501234567"
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                  <p className="text-[11px] text-neutral-400 mt-1">פורמט בינלאומי, ללא פלוס או אפס מוביל</p>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Instance ID</label>
                  <input value={greenApiInstanceId} onChange={e => setGreenApiInstanceId(e.target.value)}
                    dir="ltr" placeholder="1101234567"
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">API Token</label>
                  <input type="password" value={greenApiToken} onChange={e => setGreenApiToken(e.target.value)}
                    dir="ltr" placeholder="••••••••"
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                </div>
              </div>
            </div>
          )}

          {canOwnWhatsapp && configured && <QrConnect />}

          <div className="bg-white border border-neutral-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">💬</span>
              <h3 className="text-sm font-semibold text-neutral-900">הודעת פתיחה בוואטסאפ</h3>
            </div>
            <p className="text-xs text-neutral-500 mb-3 leading-relaxed">
              כשלקוח לוחץ על &quot;קבע תור דרך הוואטסאפ&quot; בדף הבית, הטקסט הזה כבר יופיע לו כתוב מראש בהודעה — הוא רק צריך לשלוח.
            </p>

            <label className="flex items-center justify-between cursor-pointer mb-4 pb-4 border-b border-neutral-100">
              <div>
                <p className="text-sm font-medium text-neutral-800">הצג בועה &quot;קבע תור דרך הוואטסאפ&quot;</p>
                <p className="text-xs text-neutral-400 mt-0.5">בועה קופצת ליד כפתור הוואטסאפ בדף הבית שמזמינה לקבוע תור בצ&apos;אט.</p>
              </div>
              <button
                onClick={() => setWhatsappBubbleEnabled(v => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 mr-4 ${whatsappBubbleEnabled ? "bg-teal-600" : "bg-neutral-300"}`}>
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${whatsappBubbleEnabled ? "right-0.5" : "left-0.5"}`} />
              </button>
            </label>

            <label className="text-xs text-neutral-500 block mb-1">ההודעה</label>
            <textarea
              value={whatsappPrefill}
              onChange={e => setWhatsappPrefill(e.target.value)}
              rows={2}
              placeholder="לדוגמה: היי, אשמח לקבוע תור 🙏"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
            <p className="text-[11px] text-neutral-400 mt-2 leading-relaxed">
              השאר ריק כדי שהצ&apos;אט ייפתח בלי הודעה מוכנה מראש.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setChatsEnabled(v => !v)}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${chatsEnabled ? "bg-teal-500" : "bg-neutral-200"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${chatsEnabled ? "right-0.5" : "left-0.5"}`} />
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${chatsEnabled ? "text-neutral-800" : "text-neutral-400"}`}>
                  💬 שיחות עם לקוחות
                </p>
                <p className="text-xs text-neutral-400">
                  נהל שיחות WhatsApp עם הלקוחות מתוך המערכת — בלי להיות מחובר ישירות לוואצאפ.
                  היסטוריית שיחות נשמרת ל-7 ימים אחורה.
                </p>
              </div>
            </div>
          </div>

          <button onClick={save} disabled={saving}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition ${saved ? "bg-emerald-500 text-white" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
            {saving ? "שומר..." : saved ? "✓ נשמר!" : "שמור שינויים"}
          </button>

          {configured && (
            <div className="bg-neutral-50 rounded-2xl border border-dashed border-neutral-300 p-6">
              <h3 className="font-semibold text-neutral-800 mb-2">🧪 שלח הודעת בדיקה</h3>
              <p className="text-xs text-neutral-500 mb-3">בדוק שההגדרות נכונות על ידי שליחת הודעה לטלפון שלך</p>
              <div className="flex gap-2">
                <input value={testPhone} onChange={e => setTestPhone(e.target.value)}
                  placeholder="0501234567" dir="ltr"
                  className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
                <button onClick={runTest} disabled={testing || !testPhone}
                  className="bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-400 disabled:opacity-50">
                  {testing ? "שולח..." : "שלח"}
                </button>
              </div>
              {testResult && (
                <div className={`mt-3 text-xs rounded-lg px-3 py-2 ${testResult.ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                  {testResult.ok ? "✓ נשלח בהצלחה!" : `❌ ${testResult.error || "שגיאה"}`}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
