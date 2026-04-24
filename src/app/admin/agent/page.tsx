"use client";

import { useEffect, useState } from "react";

type FAQ = { id?: string; question: string; answer: string; sortOrder?: number };
type Config = {
  id?: string;
  isEnabled: boolean;
  agentName: string;
  systemPrompt: string | null;
  greetingMsg: string | null;
  escalatePhone: string | null;
  maxIdleMinutes: number;
  faqs: FAQ[];
};

type ConvMessage = {
  id: string;
  role: string;
  content: string;
  toolName: string | null;
  createdAt: string;
};
type Conversation = {
  id: string;
  phone: string;
  status: string;
  lastMessageAt: string | null;
  createdAt: string;
  messages: ConvMessage[];
};

const WEBHOOK_URL =
  typeof window !== "undefined"
    ? `${window.location.origin}/api/webhook/whatsapp`
    : "/api/webhook/whatsapp";

export default function AdminAgentPage() {
  const [tab, setTab] = useState<"config" | "conversations">("config");
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // FAQ editing
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [newQ, setNewQ] = useState("");
  const [newA, setNewA] = useState("");

  // Conversations
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [convsLoading, setConvsLoading] = useState(false);

  // Load config
  useEffect(() => {
    fetch("/api/admin/agent")
      .then(r => r.json())
      .then((d: Config) => {
        setConfig(d);
        setFaqs(d.faqs ?? []);
      });
  }, []);

  // Load conversations when tab switches
  useEffect(() => {
    if (tab === "conversations") loadConversations();
  }, [tab]);

  async function loadConversations() {
    setConvsLoading(true);
    const data = await fetch("/api/admin/agent/conversations").then(r => r.json());
    setConvs(Array.isArray(data) ? data : []);
    setConvsLoading(false);
  }

  async function saveConfig() {
    if (!config) return;
    setSaving(true);
    // Save main config
    await fetch("/api/admin/agent", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    // Save FAQs
    await fetch("/api/admin/agent/faqs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faqs }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function addFAQ() {
    if (!newQ.trim() || !newA.trim()) return;
    setFaqs(prev => [...prev, { question: newQ.trim(), answer: newA.trim() }]);
    setNewQ("");
    setNewA("");
  }

  function removeFAQ(idx: number) {
    setFaqs(prev => prev.filter((_, i) => i !== idx));
  }

  async function resolveConversation(id: string) {
    await fetch("/api/admin/agent/conversations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "resolved" }),
    });
    await loadConversations();
    if (selectedConv?.id === id) setSelectedConv(null);
  }

  async function reopenConversation(id: string) {
    await fetch("/api/admin/agent/conversations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "active" }),
    });
    await loadConversations();
  }

  if (!config) {
    return <div className="p-8 text-center text-neutral-400 h-full flex items-center justify-center">טוען...</div>;
  }

  return (
    <div className="p-6 overflow-auto h-full" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">🤖 סוכן WhatsApp</h1>
          <p className="text-neutral-500 text-sm mt-0.5">עונה ללקוחות, קובע תורים, עוזר — אוטומטית</p>
        </div>
        {/* Toggle */}
        <button
          onClick={() => setConfig(c => c ? { ...c, isEnabled: !c.isEnabled } : c)}
          className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none ${
            config.isEnabled ? "bg-emerald-500" : "bg-neutral-300"
          }`}
        >
          <span className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
            config.isEnabled ? "-translate-x-7" : "-translate-x-1"
          }`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-neutral-100 rounded-xl p-1 w-fit">
        {(["config", "conversations"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
              tab === t ? "bg-white shadow text-neutral-900" : "text-neutral-500 hover:text-neutral-700"
            }`}
          >
            {t === "config" ? "⚙️ הגדרות" : "💬 שיחות"}
          </button>
        ))}
      </div>

      {/* ── CONFIG TAB ─────────────────────────────────────────────────────────── */}
      {tab === "config" && (
        <div className="space-y-6 max-w-2xl">
          {/* Basic settings */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4">
            <h2 className="font-semibold text-neutral-800">הגדרות בסיסיות</h2>

            <label className="block">
              <span className="text-xs text-neutral-500 block mb-1">שם הסוכן (מה שהלקוח יראה)</span>
              <input
                value={config.agentName}
                onChange={e => setConfig(c => c ? { ...c, agentName: e.target.value } : c)}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="הסוכן"
              />
            </label>

            <label className="block">
              <span className="text-xs text-neutral-500 block mb-1">טלפון להסלמה (כשהסוכן לא מצליח לעזור)</span>
              <input
                value={config.escalatePhone ?? ""}
                onChange={e => setConfig(c => c ? { ...c, escalatePhone: e.target.value } : c)}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="0501234567"
                dir="ltr"
              />
            </label>

            <label className="block">
              <span className="text-xs text-neutral-500 block mb-1">זמן חוסר פעילות לסגירת שיחה (דקות)</span>
              <input
                type="number"
                min={5}
                max={1440}
                value={config.maxIdleMinutes}
                onChange={e => setConfig(c => c ? { ...c, maxIdleMinutes: parseInt(e.target.value) || 30 } : c)}
                className="w-32 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                dir="ltr"
              />
            </label>
          </div>

          {/* System prompt */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-3">
            <div>
              <h2 className="font-semibold text-neutral-800">הנחיות מיוחדות לסוכן</h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                השאר ריק לשימוש בהנחיות ברירת המחדל. מלא רק אם רוצה לשנות את ה"אישיות" של הסוכן.
              </p>
            </div>
            <textarea
              value={config.systemPrompt ?? ""}
              onChange={e => setConfig(c => c ? { ...c, systemPrompt: e.target.value } : c)}
              rows={5}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              placeholder="לדוגמה: אתה ספר מקצועי ידידותי שעוזר ללקוחות..."
            />
          </div>

          {/* FAQs */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-neutral-800">שאלות ותשובות נפוצות</h2>
              <p className="text-xs text-neutral-400 mt-0.5">הסוכן ישתמש בתשובות אלו כשלקוחות שואלים שאלות נפוצות.</p>
            </div>

            <div className="space-y-2">
              {faqs.map((faq, idx) => (
                <div key={idx} className="bg-neutral-50 rounded-xl p-3 flex gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-800 truncate">ש: {faq.question}</p>
                    <p className="text-xs text-neutral-500 mt-0.5 line-clamp-2">ת: {faq.answer}</p>
                  </div>
                  <button
                    onClick={() => removeFAQ(idx)}
                    className="text-red-400 hover:text-red-600 text-xs px-2 flex-shrink-0"
                  >
                    מחק
                  </button>
                </div>
              ))}
            </div>

            {/* Add FAQ */}
            <div className="border border-dashed border-neutral-300 rounded-xl p-4 space-y-2">
              <p className="text-xs text-neutral-500 font-medium">הוספת שאלה ותשובה</p>
              <input
                value={newQ}
                onChange={e => setNewQ(e.target.value)}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="מה שעות הפעילות?"
              />
              <textarea
                value={newA}
                onChange={e => setNewA(e.target.value)}
                rows={2}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                placeholder="אנחנו פתוחים ראשון עד חמישי 09:00-20:00, שישי 08:00-14:00"
              />
              <button
                onClick={addFAQ}
                disabled={!newQ.trim() || !newA.trim()}
                className="bg-amber-500 text-neutral-950 px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-400 disabled:opacity-40"
              >
                + הוסף
              </button>
            </div>
          </div>

          {/* Webhook info */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-2">
            <h2 className="font-semibold text-neutral-800">🔗 הגדרת Webhook ב-Green API</h2>
            <p className="text-xs text-neutral-600">
              כדי שהסוכן יקבל הודעות נכנסות, יש להגדיר את ה-Webhook URL הבא בלוח הניהול של Green API:
            </p>
            <div className="bg-white border border-amber-200 rounded-lg px-3 py-2 font-mono text-xs text-neutral-700 break-all select-all" dir="ltr">
              {WEBHOOK_URL}
            </div>
            <p className="text-xs text-neutral-500">
              לחץ על הכתובת כדי לסמן → העתק → הדבק בשדה Webhook URL בהגדרות Instance ב-Green API
            </p>
          </div>

          {/* Save */}
          <div className="flex justify-end">
            <button
              onClick={saveConfig}
              disabled={saving}
              className="bg-amber-500 text-neutral-950 px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-400 disabled:opacity-50 transition min-w-24"
            >
              {saving ? "שומר..." : saved ? "✓ נשמר!" : "שמור שינויים"}
            </button>
          </div>
        </div>
      )}

      {/* ── CONVERSATIONS TAB ──────────────────────────────────────────────────── */}
      {tab === "conversations" && (
        <div className="flex gap-4 h-[calc(100vh-220px)]">
          {/* List */}
          <div className="w-72 flex-shrink-0 bg-white border border-neutral-200 rounded-2xl overflow-hidden flex flex-col">
            <div className="p-3 border-b border-neutral-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-neutral-800">שיחות</span>
              <button onClick={loadConversations} className="text-xs text-neutral-400 hover:text-neutral-600">רענן</button>
            </div>
            <div className="overflow-y-auto flex-1">
              {convsLoading ? (
                <div className="p-4 text-center text-neutral-400 text-sm">טוען...</div>
              ) : convs.length === 0 ? (
                <div className="p-6 text-center text-neutral-400 text-sm">
                  <p className="text-2xl mb-2">💬</p>
                  <p>אין שיחות עדיין</p>
                </div>
              ) : (
                convs.map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConv(conv)}
                    className={`w-full text-right p-3 border-b border-neutral-50 hover:bg-neutral-50 transition ${
                      selectedConv?.id === conv.id ? "bg-amber-50 border-amber-100" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm font-medium text-neutral-800 font-mono" dir="ltr">{conv.phone}</span>
                      <StatusBadge status={conv.status} />
                    </div>
                    <p className="text-xs text-neutral-400 truncate">
                      {conv.messages[conv.messages.length - 1]?.content.slice(0, 50) ?? "—"}
                    </p>
                    {conv.lastMessageAt && (
                      <p className="text-[10px] text-neutral-300 mt-0.5">
                        {new Date(conv.lastMessageAt).toLocaleString("he-IL", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric" })}
                      </p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Detail */}
          <div className="flex-1 bg-white border border-neutral-200 rounded-2xl overflow-hidden flex flex-col">
            {!selectedConv ? (
              <div className="flex-1 flex items-center justify-center text-neutral-300 flex-col gap-2">
                <span className="text-4xl">💬</span>
                <p className="text-sm">בחר שיחה מהרשימה</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-neutral-800 font-mono" dir="ltr">{selectedConv.phone}</p>
                    <p className="text-xs text-neutral-400">
                      {new Date(selectedConv.createdAt).toLocaleDateString("he-IL")}
                      {" · "}
                      {selectedConv.messages.length} הודעות
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {selectedConv.status !== "resolved" && (
                      <button
                        onClick={() => resolveConversation(selectedConv.id)}
                        className="text-xs px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition"
                      >
                        ✓ סגור שיחה
                      </button>
                    )}
                    {selectedConv.status === "resolved" && (
                      <button
                        onClick={() => reopenConversation(selectedConv.id)}
                        className="text-xs px-3 py-1.5 rounded-full bg-neutral-50 border border-neutral-200 text-neutral-600 hover:bg-neutral-100 transition"
                      >
                        פתח מחדש
                      </button>
                    )}
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {selectedConv.messages
                    .filter(m => m.role !== "tool")
                    .map(msg => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm ${
                            msg.role === "user"
                              ? "bg-amber-500 text-neutral-950 rounded-tr-sm"
                              : "bg-neutral-100 text-neutral-800 rounded-tl-sm"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                          <p className={`text-[10px] mt-1 ${msg.role === "user" ? "text-amber-800" : "text-neutral-400"}`}>
                            {new Date(msg.createdAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active:    { label: "פעיל",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    escalated: { label: "הסלמה",   cls: "bg-amber-50 text-amber-700 border-amber-200" },
    resolved:  { label: "סגור",    cls: "bg-neutral-50 text-neutral-400 border-neutral-200" },
  };
  const s = map[status] ?? { label: status, cls: "bg-neutral-50 text-neutral-400 border-neutral-200" };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${s.cls}`}>{s.label}</span>
  );
}
