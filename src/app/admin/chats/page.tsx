"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type ChatListItem = {
  id: string;
  phone: string;
  customerName: string | null;
  status: string;
  escalated: boolean;
  lastMessageAt: string | null;
  lastMessageSnippet: string;
  lastMessageRole: string | null;
  unreadCount: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  source: "agent" | "admin";
  content: string;
  createdAt: string;
};

type ChatDetail = {
  id: string;
  phone: string;
  customerName: string | null;
  customerId: string | null;
  status: string;
  escalated: boolean;
  escalatedAt: string | null;
  lastMessageAt: string | null;
  messages: ChatMessage[];
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "עכשיו";
  if (m < 60) return `לפני ${m} דק'`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} שעות`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `לפני ${d} ימים`;
  return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "short" });
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatsPage() {
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── List polling ────────────────────────────────────────────────────────────
  const fetchList = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    fetch("/api/admin/chats")
      .then(r => r.ok ? r.json() : [])
      .then((d: ChatListItem[]) => { setChats(Array.isArray(d) ? d : []); setLoadingList(false); })
      .catch(() => setLoadingList(false));
  }, []);
  useEffect(() => {
    fetchList();
    const id = setInterval(fetchList, 10_000);
    document.addEventListener("visibilitychange", fetchList);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", fetchList); };
  }, [fetchList]);

  // ── Detail polling ──────────────────────────────────────────────────────────
  const fetchDetail = useCallback((id: string) => {
    if (document.visibilityState !== "visible") return;
    fetch(`/api/admin/chats/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: ChatDetail | null) => { if (d) setDetail(d); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!selId) { setDetail(null); return; }
    fetchDetail(selId);
    const id = setInterval(() => fetchDetail(selId), 10_000);
    const onVis = () => fetchDetail(selId);
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [selId, fetchDetail]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages.length]);

  // ── Send message ────────────────────────────────────────────────────────────
  async function send() {
    if (!selId || !draft.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/chats/${selId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: draft.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error || "שגיאה בשליחה"); }
      else {
        setDraft("");
        fetchDetail(selId);
        fetchList();
      }
    } catch {
      setError("שגיאת חיבור");
    }
    setSending(false);
  }

  // ── Toggle agent for this conversation ──────────────────────────────────────
  async function toggleAgent(active: boolean) {
    if (!selId) return;
    await fetch(`/api/admin/chats/${selId}/toggle-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    fetchDetail(selId);
    fetchList();
  }

  const filteredChats = chats.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (c.customerName?.toLowerCase().includes(q) ?? false) || c.phone.includes(q);
  });

  return (
    <div className="flex h-full bg-slate-50">

      {/* ── List ── */}
      <aside className={`${selId ? "hidden md:flex" : "flex"} flex-col w-full md:w-80 bg-white border-l border-slate-200`}>
        <div className="px-4 py-3 border-b border-slate-200">
          <h1 className="text-lg font-bold text-slate-900 mb-2">💬 שיחות</h1>
          <input
            type="search"
            placeholder="חיפוש לפי שם או טלפון..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="p-6 text-center text-slate-400 text-sm">טוען...</div>
          ) : filteredChats.length === 0 ? (
            <div className="p-6 text-center text-slate-400">
              <p className="text-3xl mb-2">📭</p>
              <p className="text-sm">{search ? "לא נמצאו תוצאות" : "אין שיחות"}</p>
            </div>
          ) : (
            filteredChats.map(c => (
              <button
                key={c.id}
                onClick={() => setSelId(c.id)}
                className={`w-full text-right px-4 py-3 border-b border-slate-100 transition ${
                  selId === c.id ? "bg-teal-50" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold text-sm text-slate-900 truncate">
                    {c.customerName || c.phone}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.escalated && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">🤖 כבוי</span>}
                    {c.unreadCount > 0 && (
                      <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center">
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-500 truncate" dir="auto">
                  {c.lastMessageRole === "assistant" && <span className="text-slate-400">→ </span>}
                  {c.lastMessageSnippet || "—"}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">{timeAgo(c.lastMessageAt)}</p>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ── Detail ── */}
      <section className={`${selId ? "flex" : "hidden md:flex"} flex-col flex-1 min-w-0 bg-white`}>
        {!detail ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            בחר שיחה מהרשימה
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 shrink-0">
              <button
                onClick={() => setSelId(null)}
                className="md:hidden text-slate-500 hover:text-slate-800 text-lg"
                aria-label="חזרה"
              >
                ←
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 truncate">{detail.customerName || detail.phone}</p>
                <p className="text-xs text-slate-400" dir="ltr">{detail.phone}</p>
              </div>
              <button
                onClick={() => toggleAgent(detail.escalated)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold border transition ${
                  detail.escalated
                    ? "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                    : "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                }`}
                title={detail.escalated ? "הסוכן כבוי לשיחה זו — לחץ להפעלה" : "הסוכן פעיל לשיחה זו — לחץ לכיבוי"}
              >
                🤖 {detail.escalated ? "כבוי" : "פעיל"}
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50">
              {detail.messages.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-12">אין הודעות</p>
              ) : (
                detail.messages.map(m => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 shadow-sm ${
                      m.role === "user"
                        ? "bg-white border border-slate-200 text-slate-800"
                        : m.source === "admin"
                          ? "bg-teal-600 text-white"
                          : "bg-emerald-100 text-emerald-900 border border-emerald-200"
                    }`}>
                      {m.role === "assistant" && (
                        <p className={`text-[10px] mb-0.5 ${m.source === "admin" ? "text-white/70" : "text-emerald-700"}`}>
                          {m.source === "admin" ? "👤 אתה" : "🤖 סוכן"}
                        </p>
                      )}
                      <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                      <p className={`text-[10px] mt-1 ${
                        m.role === "user" ? "text-slate-400"
                        : m.source === "admin" ? "text-white/60"
                        : "text-emerald-600"
                      }`} dir="ltr">
                        {timeOnly(m.createdAt)}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className="border-t border-slate-200 p-3 shrink-0 bg-white safe-bottom">
              {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
              <div className="flex gap-2 items-end">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                  }}
                  placeholder="כתוב הודעה... (Enter לשליחה, Shift+Enter שורה חדשה)"
                  rows={2}
                  className="flex-1 resize-none border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
                <button
                  onClick={send}
                  disabled={!draft.trim() || sending}
                  className="bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-xl text-sm transition shrink-0"
                >
                  {sending ? "..." : "שלח"}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5 text-center">
                {detail.escalated
                  ? "🤖 הסוכן כבוי לשיחה זו (24 שעות מההודעה האחרונה שלך)"
                  : "💡 שליחה ידנית תכבה את הסוכן ל-24 שעות"
                }
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
