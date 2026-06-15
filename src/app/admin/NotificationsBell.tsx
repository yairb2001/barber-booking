"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type FeedEvent = {
  id: string;
  type: "booking" | "cancellation";
  at: string;
  customerName: string;
  staffName: string;
  serviceName: string;
  dateLabel: string;
  startTime: string;
  unread: boolean;
};

// Relative Hebrew "time ago" for the event timestamp.
function timeAgo(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "הרגע";
  if (min < 60) return `לפני ${min} ד׳`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `לפני ${hr} שע׳`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "אתמול";
  return `לפני ${days} ימים`;
}

export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [hasUnread, setHasUnread] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);

  const fetchFeed = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/notifications");
      if (!r.ok) return;
      const data = await r.json();
      setEvents(Array.isArray(data.events) ? data.events : []);
      setHasUnread(!!data.hasUnread);
      setIsOwner(!!data.isOwner);
    } catch { /* ignore — offline/transient */ }
    finally { setLoading(false); }
  }, []);

  // Smart polling: only while the tab is visible (CLAUDE.md convention).
  useEffect(() => {
    fetchFeed();
    const tick = () => { if (document.visibilityState === "visible") fetchFeed(); };
    const id = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [fetchFeed]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && hasUnread) {
      // Opening clears the red dot — mark seen on the server.
      setHasUnread(false);
      setEvents(prev => prev.map(e => ({ ...e, unread: false })));
      try { await fetch("/api/admin/notifications", { method: "POST" }); } catch { /* ignore */ }
    }
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={toggle}
        aria-label="התראות"
        className="w-9 h-9 rounded-lg hover:bg-neutral-100 text-neutral-600 flex items-center justify-center relative transition">
        {/* Bell icon */}
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {/* Red dot — presence only, no count */}
        {hasUnread && (
          <span className="absolute top-1.5 right-1.5 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 ring-2 ring-white" />
          </span>
        )}
      </button>

      {open && (
        <div
          dir="rtl"
          className="absolute left-0 mt-2 w-[320px] max-w-[88vw] max-h-[70vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-neutral-200 z-50">
          <div className="sticky top-0 bg-white px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
            <span className="text-sm font-bold text-neutral-800">התראות</span>
            <span className="text-[11px] text-neutral-400">{isOwner ? "כל הספרים" : "ההתראות שלך"}</span>
          </div>

          {loading ? (
            <div className="px-4 py-8 text-center text-xs text-neutral-400">טוען...</div>
          ) : events.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <div className="text-2xl mb-2">🔔</div>
              <p className="text-xs text-neutral-400">אין התראות חדשות</p>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {events.map(e => {
                const isCancel = e.type === "cancellation";
                const main = isCancel
                  ? (isOwner ? `${e.customerName} ביטל/ה תור${e.staffName ? ` אצל ${e.staffName}` : ""}` : `${e.customerName} ביטל/ה תור`)
                  : (isOwner ? `${e.customerName} קבע/ה תור${e.staffName ? ` אצל ${e.staffName}` : ""}` : `${e.customerName} קבע/ה תור`);
                return (
                  <li key={e.id} className={`px-4 py-3 flex gap-3 ${e.unread ? "bg-teal-50/60" : ""}`}>
                    <span className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm ${isCancel ? "bg-red-100" : "bg-teal-100"}`}>
                      {isCancel ? "✕" : "📅"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-neutral-800 leading-snug">{main}</p>
                      <p className="text-[12px] text-neutral-500 mt-0.5 leading-snug">
                        {e.serviceName && <span>{e.serviceName} · </span>}
                        {e.dateLabel} בשעה <span dir="ltr">{e.startTime}</span>
                      </p>
                      <p className="text-[10px] text-neutral-400 mt-1">{timeAgo(e.at)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
