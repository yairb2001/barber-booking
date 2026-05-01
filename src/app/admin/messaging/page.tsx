"use client";

import { useState, useEffect } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────
type FilterCategory = "all" | "upcoming" | "active" | "inactive" | "new";
type UpcomingPeriod = "today" | "tomorrow" | "3days" | "week";

type Staff = { id: string; name: string };

type MessageLog = {
  id: string;
  customerPhone: string;
  kind: string;
  status: string;
  body: string;
  createdAt: string;
  sentAt: string | null;
};

type BroadcastResult = { ok: boolean; sent: number; skipped: number; total: number };

// ── Audience & filter config ──────────────────────────────────────────────────
const UPCOMING_OPTIONS: { value: UpcomingPeriod; label: string }[] = [
  { value: "today",    label: "היום" },
  { value: "tomorrow", label: "מחר" },
  { value: "3days",    label: "3 ימים הקרובים" },
  { value: "week",     label: "השבוע" },
];

const ACTIVE_OPTIONS   = [7, 14, 30, 90, 180] as const;
const INACTIVE_OPTIONS = [30, 60, 90, 180, 365] as const;
const NEW_OPTIONS      = [7, 14, 30, 90] as const;

function daysLabel(n: number) {
  if (n === 7)  return "שבוע אחרון";
  if (n === 14) return "שבועיים אחרונים";
  if (n === 30) return "חודש אחרון";
  if (n === 60) return "חודשיים אחרונים";
  if (n === 90) return "3 חודשים אחרונים";
  if (n === 180) return "6 חודשים אחרונים";
  if (n === 365) return "שנה אחרונה";
  return `${n} ימים`;
}

// ── Build API params from current filter state ────────────────────────────────
function buildParams(staffId: string, category: FilterCategory, opts: {
  upcoming: UpcomingPeriod; activeDays: number; inactiveDays: number; newDays: number;
}) {
  const params = new URLSearchParams({ limit: "2000" });
  if (staffId) params.set("staffId", staffId);
  if (category === "upcoming")  params.set("upcoming", opts.upcoming);
  if (category === "active")    params.set("active_days",   String(opts.activeDays));
  if (category === "inactive")  params.set("inactive_days", String(opts.inactiveDays));
  if (category === "new")       params.set("new_days",      String(opts.newDays));
  return params.toString();
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function MessagingPage() {
  const [tab, setTab] = useState<"send" | "history">("send");

  // Audience
  const [staffId, setStaffId] = useState("");       // "" = all
  const [allStaff, setAllStaff] = useState<Staff[]>([]);

  // Filter
  const [category,    setCategory]    = useState<FilterCategory>("all");
  const [upcoming,    setUpcoming]    = useState<UpcomingPeriod>("today");
  const [activeDays,  setActiveDays]  = useState(30);
  const [inactiveDays,setInactiveDays]= useState(90);
  const [newDays,     setNewDays]     = useState(30);

  // Count estimate
  const [totalCount,   setTotalCount]   = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);

  // Send
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState<BroadcastResult | null>(null);

  // History
  const [history,    setHistory]    = useState<MessageLog[]>([]);
  const [histLoading,setHistLoading]= useState(false);

  // Load staff list
  useEffect(() => {
    fetch("/api/admin/staff").then(r => r.json()).then(setAllStaff).catch(() => {});
  }, []);

  // Load customer count estimate whenever filter changes
  useEffect(() => {
    setLoadingCount(true);
    const qs = buildParams(staffId, category, { upcoming, activeDays, inactiveDays, newDays });
    fetch(`/api/admin/customers?${qs}`)
      .then(r => r.json())
      .then(data => { setTotalCount(Array.isArray(data) ? data.length : 0); setLoadingCount(false); })
      .catch(() => setLoadingCount(false));
  }, [staffId, category, upcoming, activeDays, inactiveDays, newDays]);

  // Load history
  useEffect(() => {
    if (tab !== "history") return;
    setHistLoading(true);
    fetch("/api/admin/messaging/broadcast")
      .then(r => r.json())
      .then(data => { setHistory(Array.isArray(data) ? data : []); setHistLoading(false); })
      .catch(() => setHistLoading(false));
  }, [tab]);

  // Send broadcast
  async function handleSend() {
    setSending(true);
    setResult(null);
    try {
      const qs = buildParams(staffId, category, { upcoming, activeDays, inactiveDays, newDays });
      const res = await fetch("/api/admin/messaging/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, filterQuery: qs }),
      });
      const data = await res.json();
      setResult(data);
      setConfirm(false);
      setMessage("");
    } finally {
      setSending(false);
    }
  }

  // Human-readable summary of current filter
  function filterSummary() {
    const who = staffId ? (allStaff.find(s => s.id === staffId)?.name || "ספר") : "כל הלקוחות";
    if (category === "all")      return who;
    if (category === "upcoming") return `${who} · ממתינים לתור — ${UPCOMING_OPTIONS.find(o => o.value === upcoming)?.label}`;
    if (category === "active")   return `${who} · פעילים — ${daysLabel(activeDays)}`;
    if (category === "inactive") return `${who} · לא פעילים מזה ${daysLabel(inactiveDays)}`;
    if (category === "new")      return `${who} · חדשים — ${daysLabel(newDays)}`;
    return who;
  }

  return (
    <div className="p-4 sm:p-6 overflow-auto h-full max-w-2xl">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-900">הודעות תפוצה</h1>
        <p className="text-neutral-500 text-sm mt-1">שלח הודעת WhatsApp לקבוצת לקוחות</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-neutral-100 rounded-xl p-1 mb-5 w-fit">
        {[{ key: "send", label: "📤 שלח הודעה" }, { key: "history", label: "📋 היסטוריה" }].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key as "send" | "history")}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === key ? "bg-white shadow text-neutral-900" : "text-neutral-500"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Send Tab ── */}
      {tab === "send" && (
        <div className="space-y-4">

          {/* ── 1. Audience ── */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-5">
            <h2 className="font-semibold text-neutral-800 mb-3 text-sm">👥 קהל יעד</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setStaffId("")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${!staffId ? "bg-teal-600 text-white border-teal-700" : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"}`}>
                כל הלקוחות
              </button>
              {allStaff.map(s => (
                <button key={s.id}
                  onClick={() => setStaffId(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${staffId === s.id ? "bg-teal-600 text-white border-teal-700" : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"}`}>
                  ✂️ {s.name}
                </button>
              ))}
            </div>
          </div>

          {/* ── 2. Filter ── */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-5">
            <h2 className="font-semibold text-neutral-800 mb-4 text-sm">🎯 סינון לקוחות</h2>

            <div className="space-y-3">

              {/* All */}
              <FilterRow
                active={category === "all"}
                label="כל הלקוחות"
                emoji="✅"
                onClick={() => { setCategory("all"); setResult(null); }}
              />

              {/* Upcoming appointments */}
              <FilterRow
                active={category === "upcoming"}
                label="ממתינים לתור"
                emoji="📅"
                onClick={() => { setCategory("upcoming"); setResult(null); }}>
                {category === "upcoming" && (
                  <div className="flex flex-wrap gap-1.5 mt-2 mr-6">
                    {UPCOMING_OPTIONS.map(opt => (
                      <button key={opt.value}
                        onClick={e => { e.stopPropagation(); setUpcoming(opt.value); }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${upcoming === opt.value ? "bg-teal-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </FilterRow>

              {/* Active */}
              <FilterRow
                active={category === "active"}
                label="לקוחות פעילים"
                emoji="🟢"
                onClick={() => { setCategory("active"); setResult(null); }}>
                {category === "active" && (
                  <div className="flex flex-wrap gap-1.5 mt-2 mr-6">
                    {ACTIVE_OPTIONS.map(n => (
                      <button key={n}
                        onClick={e => { e.stopPropagation(); setActiveDays(n); }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${activeDays === n ? "bg-teal-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>
                        {daysLabel(n)}
                      </button>
                    ))}
                  </div>
                )}
              </FilterRow>

              {/* Inactive */}
              <FilterRow
                active={category === "inactive"}
                label="לקוחות לא פעילים"
                emoji="🔴"
                onClick={() => { setCategory("inactive"); setResult(null); }}>
                {category === "inactive" && (
                  <div className="flex flex-wrap gap-1.5 mt-2 mr-6">
                    {INACTIVE_OPTIONS.map(n => (
                      <button key={n}
                        onClick={e => { e.stopPropagation(); setInactiveDays(n); }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${inactiveDays === n ? "bg-teal-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>
                        {daysLabel(n)}
                      </button>
                    ))}
                  </div>
                )}
              </FilterRow>

              {/* New */}
              <FilterRow
                active={category === "new"}
                label="לקוחות חדשים"
                emoji="✨"
                onClick={() => { setCategory("new"); setResult(null); }}>
                {category === "new" && (
                  <div className="flex flex-wrap gap-1.5 mt-2 mr-6">
                    {NEW_OPTIONS.map(n => (
                      <button key={n}
                        onClick={e => { e.stopPropagation(); setNewDays(n); }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${newDays === n ? "bg-teal-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>
                        {daysLabel(n)}
                      </button>
                    ))}
                  </div>
                )}
              </FilterRow>
            </div>

            {/* Count estimate */}
            <div className="mt-3 pt-3 border-t border-neutral-100 text-xs text-neutral-500">
              {loadingCount ? (
                <span className="animate-pulse">בודק מספר לקוחות...</span>
              ) : totalCount !== null ? (
                <span>
                  נמצאו <strong className="text-neutral-800">{totalCount}</strong> לקוחות בקבוצה זו
                </span>
              ) : null}
            </div>
          </div>

          {/* ── 3. Message ── */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-neutral-800 text-sm">✍️ כתוב את ההודעה</h2>
              <span className="text-xs text-neutral-400">{message.length} תווים</span>
            </div>
            <textarea
              value={message}
              onChange={e => { setMessage(e.target.value); setResult(null); }}
              placeholder={`שלום {{name}} 👋\n\nיש לנו חדשות שמחות...`}
              rows={7}
              dir="rtl"
              className="w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              <button
                onClick={() => setMessage(m => m + "{{name}}")}
                className="text-[11px] bg-neutral-100 hover:bg-neutral-200 text-neutral-600 px-2 py-0.5 rounded-md font-mono transition"
                title="הוסף שם לקוח">
                {"{{name}}"}
              </button>
              <span className="text-xs text-neutral-400 self-center">← שם הלקוח יוחלף אוטומטית לכל נמען</span>
            </div>
          </div>

          {/* Result */}
          {result && (
            <div className={`rounded-xl px-4 py-3 text-sm font-medium ${result.ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
              {result.ok
                ? `✓ נשלח בהצלחה! — ${result.sent} נמענים${result.skipped > 0 ? ` (${result.skipped} נכשלו)` : ""}`
                : "❌ שגיאה בשליחה"}
            </div>
          )}

          {/* Send button / confirm */}
          {!confirm ? (
            <button
              onClick={() => setConfirm(true)}
              disabled={!message.trim() || totalCount === 0}
              className="w-full py-3 rounded-xl text-sm font-semibold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition">
              📤 שלח הודעה
            </button>
          ) : (
            <div className="bg-white border-2 border-slate-700 rounded-2xl p-5 space-y-3">
              <p className="font-semibold text-neutral-900 text-sm">אשר שליחה</p>
              <p className="text-sm text-neutral-600">
                <span className="font-medium text-neutral-800">{filterSummary()}</span>
                <br />
                ההודעה תישלח ל-<strong>{totalCount ?? "?"}</strong> לקוחות.{" "}
                <span className="text-red-500 font-medium">לא ניתן לבטל שליחה.</span>
              </p>
              <div className="bg-neutral-50 rounded-xl px-3 py-2 text-xs font-mono text-neutral-700 whitespace-pre-wrap max-h-28 overflow-y-auto">
                {message}
              </div>
              <div className="flex gap-3">
                <button onClick={handleSend} disabled={sending}
                  className="flex-1 py-2.5 rounded-xl bg-teal-600 text-white font-semibold text-sm hover:bg-teal-700 disabled:opacity-50 transition">
                  {sending ? "שולח..." : "כן, שלח"}
                </button>
                <button onClick={() => setConfirm(false)} disabled={sending}
                  className="flex-1 py-2.5 rounded-xl bg-neutral-100 text-neutral-700 font-semibold text-sm hover:bg-neutral-200 transition">
                  ביטול
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── History Tab ── */}
      {tab === "history" && (
        <div className="space-y-3">
          {histLoading ? (
            <div className="text-center py-16 text-neutral-400">טוען...</div>
          ) : history.length === 0 ? (
            <div className="text-center py-16 text-neutral-400">
              <p className="text-2xl mb-2">📭</p>
              <p>טרם נשלחו הודעות תפוצה</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-neutral-400 mb-2">{history.length} הודעות</p>
              {history.map(log => (
                <div key={log.id} className="bg-white rounded-xl border border-neutral-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-neutral-500 mb-1">{log.customerPhone}</p>
                      <p className="text-sm text-neutral-800 whitespace-pre-wrap line-clamp-3">{log.body}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        log.status === "sent"      ? "bg-emerald-100 text-emerald-700" :
                        log.status === "delivered" ? "bg-teal-100 text-teal-700" :
                        log.status === "failed"    ? "bg-red-100 text-red-500" :
                        "bg-neutral-100 text-neutral-500"
                      }`}>
                        {log.status === "sent"      ? "✓ נשלח" :
                         log.status === "delivered" ? "✓✓ נמסר" :
                         log.status === "failed"    ? "✗ נכשל" :
                         log.status}
                      </span>
                      <span className="text-[10px] text-neutral-400">
                        {new Date(log.createdAt).toLocaleDateString("he-IL", {
                          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Filter Row component ───────────────────────────────────────────────────────
function FilterRow({
  active, label, emoji, onClick, children,
}: {
  active: boolean;
  label: string;
  emoji: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border cursor-pointer transition ${active ? "border-slate-300 bg-slate-50" : "border-neutral-100 bg-neutral-50 hover:border-neutral-200"}`}
      onClick={onClick}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="text-base">{emoji}</span>
        <span className={`text-sm font-medium ${active ? "text-slate-900" : "text-neutral-700"}`}>{label}</span>
        <div className={`mr-auto w-4 h-4 rounded-full border-2 flex items-center justify-center transition ${active ? "border-teal-600 bg-teal-600" : "border-neutral-300"}`}>
          {active && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
        </div>
      </div>
      {children}
    </div>
  );
}
