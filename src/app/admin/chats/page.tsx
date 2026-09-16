"use client";

import { useEffect, useRef, useState, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";

type ChatListItem = {
  id: string;
  phone: string;
  customerName: string | null;
  whatsappName?: string | null;
  customerId?: string | null;
  snoozedUntil?: string | null;
  status: string;
  escalated: boolean;
  needsHuman: boolean;
  needsHandling: boolean;
  lastMessageAt: string | null;
  lastMessageSnippet: string;
  lastMessageRole: string | null;
  unreadCount: number;
  lastCall?: { at: string; outcome: string; case: string | null } | null;
};

type CallRow = {
  id: string; at: string; phone: string; outcome: string; direction: string; durationSec: number;
  customerId: string | null; customerName: string | null; isNew: boolean; case: string | null; reason: string | null;
  conversationId: string | null; followUp: "none" | "replied" | "booked" | "called_back"; followUpText: string | null;
  upcoming: { date: string; startTime: string } | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  source: "agent" | "admin" | "system";
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

// Chat-list timestamp, WhatsApp-style: the time today, "אתמול" yesterday, the
// weekday within the last week, and a date for anything older — so a row shows
// WHEN the last message was, not "X hours ago".
function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays <= 0) return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "אתמול";
  if (diffDays < 7)  return d.toLocaleDateString("he-IL", { weekday: "long" });
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "short" });
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

function dateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// WhatsApp-style date separator: היום / אתמול / weekday (within the last week) /
// full date for anything older — so the owner always knows WHEN a message was.
function dateSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return "היום";
  if (diffDays === 1) return "אתמול";
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString("he-IL", { weekday: "long" });
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
}

export default function ChatsPage() {
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const router = useRouter();
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState<string | null>(null);
  // A deep-linked customer who has no conversation yet: shown as an empty
  // composer, but nothing is written to the database until a message is
  // actually sent (see the "open" deep-link effect below).
  const [virtualThread, setVirtualThread] = useState<{ phone: string; customerName: string | null } | null>(null);
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  // 📞 calls tab (option B in specs/call-automation.md): the day's calls to the shop number.
  const [tab, setTab] = useState<"chats" | "calls">("chats");
  const [callsDate, setCallsDate] = useState<string>(() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); });
  const [calls, setCalls] = useState<CallRow[] | null>(null);
  useEffect(() => {
    if (tab !== "calls") return;
    let alive = true; setCalls(null);
    const load = () => fetch(`/api/admin/calls?date=${callsDate}`).then(r => (r.ok ? r.json() : [])).then(d => { if (alive) setCalls(Array.isArray(d) ? d : []); }).catch(() => { if (alive) setCalls([]); });
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [tab, callsDate]);
  const shiftCallsDate = (n: number) => setCallsDate(d => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); });
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

  // Deep-link: /admin/chats?phone=<phone>&name=<name> opens that customer's
  // thread (used by the appointment card / customer card "open conversation
  // in system" button).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get("phone");
    if (p) setPendingPhone(p);
    const n = params.get("name");
    if (n) setPendingName(n);
  }, []);
  // Look up (never create) the thread for the deep-linked phone. If one
  // already exists, open it. Otherwise show an empty composer for that
  // customer WITHOUT writing anything to the database — a conversation row
  // is only created once a message is actually sent, so merely opening a
  // customer's card never leaves a ghost empty thread in the inbox.
  useEffect(() => {
    if (!pendingPhone) return;
    let alive = true;
    fetch("/api/admin/chats/open", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: pendingPhone }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!alive) return;
        if (d?.id) { setVirtualThread(null); setSelId(d.id); fetchList(); }
        else { setSelId(null); setVirtualThread({ phone: pendingPhone, customerName: pendingName }); }
        setPendingPhone(null);
        setPendingName(null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [pendingPhone, pendingName, fetchList]);

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

  // Clear the composer whenever the selected thread changes, so a draft
  // typed for one customer never carries over and gets sent to another.
  useEffect(() => {
    setDraft("");
    setError("");
  }, [selId, virtualThread?.phone]);

  // ── Send message ────────────────────────────────────────────────────────────
  async function send() {
    if ((!selId && !virtualThread) || !draft.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      if (selId) {
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
      } else if (virtualThread) {
        // First message to a customer who never had a conversation — the
        // conversation row is created here, atomically with the message,
        // never just from opening the thread.
        const res = await fetch("/api/admin/chats/send-quick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: virtualThread.phone,
            customerName: virtualThread.customerName,
            message: draft.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) { setError(data.error || "שגיאה בשליחה"); }
        else {
          setDraft("");
          setVirtualThread(null);
          setSelId(data.conversationId);
          fetchList();
        }
      }
    } catch {
      setError("שגיאת חיבור");
    }
    setSending(false);
  }

  // ── Mark a conversation as handled (drops the red "needs handling" alert
  // without replying). A newer customer message re-flags it automatically.
  async function markHandled(id: string) {
    // Optimistic: drop the red flag immediately so the button feels instant.
    setChats(prev => prev.map(c => c.id === id ? { ...c, needsHandling: false } : c));
    await fetch(`/api/admin/chats/${id}/mark-handled`, { method: "POST" }).catch(() => {});
    fetchList();
    if (selId === id) fetchDetail(id);
  }

  // ── "Remind me later" — hides the red alert until then ──────────────────────
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);
  async function snooze(id: string, hours: number) {
    setSnoozeFor(null);
    setChats(prev => prev.map(c => c.id === id ? { ...c, needsHandling: false, snoozedUntil: new Date(Date.now() + hours * 3_600_000).toISOString() } : c));
    await fetch(`/api/admin/chats/${id}/mark-handled`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snoozeHours: hours }),
    }).catch(() => {});
    fetchList();
  }
  // Hours until tomorrow 09:00 / this evening 18:00 (Israel-local browser time).
  function hoursUntil(hour: number, tomorrow: boolean): number {
    const t = new Date(); if (tomorrow) t.setDate(t.getDate() + 1); t.setHours(hour, 0, 0, 0);
    return Math.max(0.25, (t.getTime() - Date.now()) / 3_600_000);
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

  // Either a real (server-fetched) conversation, or a virtual not-yet-created
  // one for a deep-linked customer with no history — same shape either way,
  // so the detail pane below doesn't need to special-case it.
  const activeThread: { id: string | null; phone: string; customerName: string | null; escalated: boolean; messages: ChatMessage[] } | null =
    detail ?? (virtualThread ? { id: null, phone: virtualThread.phone, customerName: virtualThread.customerName, escalated: false, messages: [] } : null);

  const filteredChats = chats.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (c.customerName?.toLowerCase().includes(q) ?? false) || c.phone.includes(q);
  });

  // Two fixed inboxes:
  //   • Top — "טיפול אנושי": every conversation a human is responsible for
  //     (escalated OR agent off). WITHIN this inbox, conversations that still
  //     need handling (the CUSTOMER spoke last — you haven't replied) float to
  //     the very top in red; ones you've already replied to sink below with a
  //     calm "✓ טופל" tag and STAY here (the agent doesn't resume). A new
  //     customer message flips it back to "needs handling" and bumps it up.
  //   • Bottom — "מטופל ע״י הסוכן": the agent's own inbox, always calm.
  // "Handled" = you replied (last message is yours), NOT merely opening the
  // chat. After 24h with no activity the escalation expires server-side and the
  // conversation moves down into the agent inbox on its own.
  const humanChats = filteredChats
    .filter(c => c.needsHuman)
    .sort((a, b) => Number(b.needsHandling) - Number(a.needsHandling));
  const agentChats = filteredChats.filter(c => !c.needsHuman);

  const renderRow = (c: ChatListItem) => {
    const needsHandling = c.needsHandling;
    // In the human inbox but you already replied → handled. Calm, not red.
    const handled = !needsHandling && c.needsHuman;
    return (
      <div
        key={c.id}
        role="button"
        tabIndex={0}
        onClick={() => { setVirtualThread(null); setSelId(c.id); }}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setVirtualThread(null); setSelId(c.id); } }}
        className={`w-full text-right px-4 py-3 border-b border-slate-100 transition cursor-pointer ${
          selId === c.id
            ? "bg-teal-50"
            : needsHandling
              ? "bg-red-50 hover:bg-red-100 border-r-4 border-r-red-500"
              : "hover:bg-slate-50"
        }`}
      >
        {c.lastCall && (
          <p className={`text-[10px] font-semibold mb-0.5 ${c.lastCall.outcome === "missed" ? "text-red-600" : "text-emerald-700"}`}>
            📞 {c.lastCall.outcome === "missed" ? "התקשר ולא נענה" : "התקשר ונענה"} {timeOnly(c.lastCall.at)}
            {c.lastCall.case && c.lastCall.case !== "none" && <span className="text-slate-400 font-normal"> · נשלחה הודעה</span>}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className={`text-sm truncate flex items-center gap-1.5 ${
            needsHandling ? "font-bold text-slate-900" : "font-semibold text-slate-800"
          }`}>
            {needsHandling && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
            <span className="truncate">
              {c.customerName || c.phone}
              {c.whatsappName && <span className="block text-[10px] font-normal text-slate-400 truncate">בוואטסאפ: {c.whatsappName}</span>}
            </span>
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {needsHandling && (
              <>
                <div className="relative">
                  <button
                    onClick={e => { e.stopPropagation(); setSnoozeFor(snoozeFor === c.id ? null : c.id); }}
                    className="text-[10px] bg-slate-50 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded-full font-medium hover:bg-slate-100 transition"
                    title="הזכר לי מאוחר יותר"
                  >
                    ⏰
                  </button>
                  {snoozeFor === c.id && (
                    <div className="absolute left-0 top-6 z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-1 w-36" onClick={e => e.stopPropagation()}>
                      {([["בעוד שעה", 1], ["הערב 18:00", hoursUntil(18, false)], ["מחר 09:00", hoursUntil(9, true)]] as const).map(([label, h]) => (
                        <button key={label} onClick={() => snooze(c.id, h)} className="w-full text-right text-xs px-2 py-1.5 rounded hover:bg-slate-50">{label}</button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); markHandled(c.id); }}
                  className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full font-medium hover:bg-emerald-100 transition"
                  title="סמן כטופל — מסיר את ההתראה האדומה בלי לענות"
                >
                  ✓ טופל
                </button>
              </>
            )}
            {!needsHandling && c.snoozedUntil && (
              <span className="text-[10px] text-slate-400" title="נודניק">⏰ {new Date(c.snoozedUntil).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</span>
            )}
            {handled && (
              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-medium">
                ✓ טופל
              </span>
            )}
          </div>
        </div>
        <p className={`text-xs truncate ${needsHandling ? "text-slate-700 font-medium" : "text-slate-500"}`} dir="auto">
          {c.lastMessageRole === "assistant" && <span className="text-slate-400">→ </span>}
          {c.lastMessageSnippet || "—"}
        </p>
        <p className="text-[10px] text-slate-400 mt-1">{timeAgo(c.lastMessageAt)}</p>
      </div>
    );
  };

  return (
    <div className="flex h-full bg-slate-50">

      {/* ── List ── */}
      <aside className={`${selId ? "hidden md:flex" : "flex"} flex-col w-full md:w-80 bg-white border-l border-slate-200`}>
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1 mb-2">
            <button onClick={() => setTab("chats")} className={`flex-1 rounded-lg py-1.5 text-sm font-semibold transition ${tab === "chats" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>💬 צ׳אטים</button>
            <button onClick={() => setTab("calls")} className={`flex-1 rounded-lg py-1.5 text-sm font-semibold transition ${tab === "calls" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>📞 שיחות</button>
          </div>
          {tab === "chats" && <input
            type="search"
            placeholder="חיפוש לפי שם או טלפון..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400"
          />}
          {tab === "calls" && (
            <div className="flex items-center justify-between">
              <button onClick={() => shiftCallsDate(1)} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">‹</button>
              <span className="text-sm font-semibold text-slate-800">{new Date(callsDate + "T12:00:00").toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric" })}</span>
              <button onClick={() => shiftCallsDate(-1)} className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500">›</button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {tab === "calls" ? (
            <CallsList rows={calls} onOpenChat={(phone, name) => { setTab("chats"); setPendingName(name); setPendingPhone(phone); }} />
          ) : loadingList ? (
            <div className="p-6 text-center text-slate-400 text-sm">טוען...</div>
          ) : filteredChats.length === 0 ? (
            <div className="p-6 text-center text-slate-400">
              <p className="text-3xl mb-2">📭</p>
              <p className="text-sm">{search ? "לא נמצאו תוצאות" : "אין שיחות"}</p>
            </div>
          ) : (
            <>
              {humanChats.length > 0 && (
                <div className="px-4 py-1.5 bg-red-100/60 text-red-700 text-[11px] font-bold sticky top-0 z-10">
                  🔴 טיפול אנושי ({humanChats.length})
                </div>
              )}
              {humanChats.map(renderRow)}
              {agentChats.length > 0 && (
                <div className="px-4 py-1.5 bg-slate-100 text-slate-500 text-[11px] font-bold sticky top-0 z-10">
                  🤖 מטופל ע״י הסוכן ({agentChats.length})
                </div>
              )}
              {agentChats.map(renderRow)}
            </>
          )}
        </div>
      </aside>

      {/* ── Detail ── */}
      <section className={`${selId || virtualThread ? "flex" : "hidden md:flex"} flex-col flex-1 min-w-0 bg-white`}>
        {!activeThread ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            בחר שיחה מהרשימה
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 shrink-0">
              <button
                onClick={() => { setSelId(null); setVirtualThread(null); }}
                className="md:hidden text-slate-500 hover:text-slate-800 text-lg"
                aria-label="חזרה"
              >
                ←
              </button>
              <button onClick={() => router.push(`/admin/customers?customer=${encodeURIComponent(activeThread.phone)}`)}
                className="flex-1 min-w-0 text-right hover:opacity-70 transition" title="פתח כרטיס לקוח">
                <p className="font-semibold text-slate-900 truncate">{activeThread.customerName || activeThread.phone}</p>
                <p className="text-xs text-slate-400" dir="ltr">{activeThread.phone}</p>
              </button>
              <button onClick={() => router.push(`/admin?book=${encodeURIComponent(activeThread.phone)}${activeThread.customerName ? `&name=${encodeURIComponent(activeThread.customerName)}` : ""}`)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold border bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100 transition"
                title="קבע תור ללקוח הזה — האישור יופיע גם כאן בשיחה">
                📅 קבע תור
              </button>
              {activeThread.id && (
                <button
                  onClick={() => toggleAgent(activeThread.escalated)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold border transition ${
                    activeThread.escalated
                      ? "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                      : "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                  }`}
                  title={activeThread.escalated ? "הסוכן כבוי לשיחה זו — לחץ להפעלה" : "הסוכן פעיל לשיחה זו — לחץ לכיבוי"}
                >
                  🤖 {activeThread.escalated ? "כבוי" : "פעיל"}
                </button>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50">
              {activeThread.messages.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-12">אין הודעות</p>
              ) : (
                activeThread.messages.map((m, i) => {
                  const prev = i > 0 ? activeThread.messages[i - 1] : null;
                  const showDate = !prev || dateKey(prev.createdAt) !== dateKey(m.createdAt);
                  return (
                    <Fragment key={m.id}>
                      {showDate && (
                        <div className="flex justify-center my-2">
                          <span className="text-[11px] text-slate-500 bg-slate-200/80 rounded-full px-3 py-0.5">
                            {dateSeparator(m.createdAt)}
                          </span>
                        </div>
                      )}
                  {m.role === "system" ? (
                    <div className="flex justify-center my-1">
                      <span className="text-[11px] text-slate-600 bg-slate-200/80 rounded-full px-3 py-1 text-center">{m.content}</span>
                    </div>
                  ) : (
                  <div className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
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
                  )}
                    </Fragment>
                  );
                })
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
                  placeholder="כתוב הודעה..."
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
                {activeThread.escalated
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


// ── 📞 Calls tab — the day's calls to the shop number, newest first ──────────
function CallsList({ rows, onOpenChat }: { rows: CallRow[] | null; onOpenChat: (phone: string, name: string | null) => void }) {
  if (rows === null) return <div className="p-6 text-center text-slate-400 text-sm">טוען...</div>;
  const incoming = rows.filter(r => r.direction === "in");
  const missed = incoming.filter(r => r.outcome === "missed").length;
  const booked = incoming.filter(r => r.followUp === "booked").length;
  const fmtPhone = (p: string) => p.startsWith("972") ? "0" + p.slice(3).replace(/(\d{2})(\d{3})(\d{4})/, "$1-$2-$3") : p;
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 px-4 py-3 border-b border-slate-100">
        <div className="bg-slate-50 rounded-xl py-2 text-center"><p className="text-lg font-extrabold text-slate-800 leading-none">{incoming.length}</p><p className="text-[10px] text-slate-500 mt-1">שיחות</p></div>
        <div className="bg-red-50 rounded-xl py-2 text-center"><p className="text-lg font-extrabold text-red-600 leading-none">{missed}</p><p className="text-[10px] text-red-600 mt-1">לא נענו</p></div>
        <div className="bg-teal-50 rounded-xl py-2 text-center"><p className="text-lg font-extrabold text-teal-700 leading-none">{booked}</p><p className="text-[10px] text-teal-700 mt-1">קבעו</p></div>
      </div>
      {incoming.length === 0 ? (
        <div className="p-6 text-center text-slate-400"><p className="text-3xl mb-2">📞</p><p className="text-sm">אין שיחות ביום הזה</p></div>
      ) : incoming.map(r => {
        const missedCall = r.outcome === "missed";
        const sentMsg = !!r.case && r.case !== "none";
        const reasonLabel: Record<string, string> = { sent_24h: "כבר נשלחה ב-24 השעות האחרונות", known_answered: "בלי הודעה", off: "האוטומציה כבויה", blocked: "חסום", opted_out: "ביקש להסיר", shabbat: "שבת", staff_number: "מספר של הצוות" };
        const after = r.followUp === "booked" ? <span className="text-teal-700 font-semibold">✓ {r.followUpText}</span>
          : r.followUp === "replied" ? <span className="text-teal-700 font-semibold">ענה: <span className="font-normal text-slate-600">"{r.followUpText}"</span></span>
          : r.followUp === "called_back" ? <span className="text-teal-700 font-semibold">{r.followUpText}</span>
          : sentMsg ? <span className="text-amber-600 font-semibold">עדיין לא ענה</span>
          : <span className="text-slate-400">{reasonLabel[r.reason ?? ""] ?? (r.reason?.startsWith("case_") ? "סוג ההודעה כבוי" : r.reason?.startsWith("send_failed") ? "השליחה נכשלה" : "בלי הודעה")}</span>;
        return (
          <div key={r.id} className="px-4 py-3 border-b border-slate-100">
            <div className="flex items-start gap-2">
              <span className="text-[11px] text-slate-400 w-10 shrink-0 pt-0.5" dir="ltr">{timeOnly(r.at)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-bold text-slate-900 truncate" dir={r.customerName ? "auto" : "ltr"}>{r.customerName || fmtPhone(r.phone)}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-px rounded-full ${missedCall ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>{missedCall ? "לא נענה" : "נענה"}</span>
                  {r.isNew
                    ? <span className="text-[10px] font-bold px-1.5 py-px rounded-full bg-amber-50 text-amber-600">★ חדש</span>
                    : r.upcoming
                      ? <span className="text-[10px] font-bold px-1.5 py-px rounded-full bg-slate-100 text-slate-500">תור {r.upcoming.date.slice(8, 10)}.{r.upcoming.date.slice(5, 7)} {r.upcoming.startTime}</span>
                      : <span className="text-[10px] font-bold px-1.5 py-px rounded-full bg-slate-100 text-slate-500">קיים</span>}
                </div>
                <p className="text-[11px] mt-0.5 truncate">{sentMsg && <span className="text-slate-400">נשלחה הודעה · </span>}{after}</p>
                <div className="flex gap-1.5 mt-1.5">
                  {(r.isNew || !r.upcoming) && (
                    <a href={`/admin?book=${encodeURIComponent(r.phone)}${r.customerName ? `&name=${encodeURIComponent(r.customerName)}` : ""}`}
                      className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700">📅 קבע תור</a>
                  )}
                  <button onClick={() => onOpenChat(r.phone, r.customerName)} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">פתח צ׳אט</button>
                  <a href={`tel:+${r.phone}`} className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">התקשר</a>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
