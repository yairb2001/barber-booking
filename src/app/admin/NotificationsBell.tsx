"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type FeedEvent = {
  id: string;
  type: "booking" | "cancellation" | "waitlist";
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
  // Toasts that "pop up" on their own when a NEW cancellation or waitlist
  // sign-up arrives.
  const [toasts, setToasts] = useState<FeedEvent[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Event ids we've already accounted for, so each one pops exactly once.
  const knownPopIds = useRef<Set<string>>(new Set());
  // First poll only seeds the "known" set — we don't pop historical events.
  const seeded = useRef(false);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const fetchFeed = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/notifications");
      if (!r.ok) return;
      const data = await r.json();
      const evs: FeedEvent[] = Array.isArray(data.events) ? data.events : [];
      setEvents(evs);
      setHasUnread(!!data.hasUnread);
      setIsOwner(!!data.isOwner);

      // Pop a toast for any cancellation or waitlist sign-up we haven't seen
      // before. On the very first load we just record the existing ones (no
      // popping) so we don't spam the owner with old events on every page open.
      const poppable = evs.filter(e => e.type === "cancellation" || e.type === "waitlist");
      if (!seeded.current) {
        poppable.forEach(c => knownPopIds.current.add(c.id));
        seeded.current = true;
      } else {
        const fresh = poppable.filter(c => !knownPopIds.current.has(c.id));
        if (fresh.length) {
          fresh.forEach(c => knownPopIds.current.add(c.id));
          setToasts(prev => [...fresh, ...prev].slice(0, 4));
          // Auto-dismiss each toast after 12s (owner can also close manually).
          fresh.forEach(c => setTimeout(() => dismissToast(c.id), 12000));
        }
      }
    } catch { /* ignore — offline/transient */ }
    finally { setLoading(false); }
  }, [dismissToast]);

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
      {/* ── Pop-up toasts: a cancellation just came in ── */}
      {toasts.length > 0 && (
        <div dir="rtl" className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[340px] max-w-[92vw] pointer-events-none">
          {toasts.map(t => {
            const isWait = t.type === "waitlist";
            const title = isWait
              ? `${t.customerName} נרשם/ה לרשימת המתנה${isOwner && t.staffName ? ` אצל ${t.staffName}` : ""}`
              : `${t.customerName} ביטל/ה תור${isOwner && t.staffName ? ` אצל ${t.staffName}` : ""}`;
            return (
            <div
              key={t.id}
              onClick={() => dismissToast(t.id)}
              className={`pointer-events-auto cursor-pointer bg-white border rounded-2xl shadow-2xl px-4 py-3 flex gap-3 items-start ring-1 ${isWait ? "border-amber-200 ring-amber-500/10" : "border-red-200 ring-red-500/10"}`}
            >
              <span className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base font-bold ${isWait ? "bg-amber-100 text-amber-600" : "bg-red-100 text-red-600"}`}>{isWait ? "⏳" : "✕"}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-neutral-900 leading-snug">{title}</p>
                <p className="text-[12px] text-neutral-500 mt-0.5 leading-snug">
                  {t.serviceName && <span>{t.serviceName} · </span>}
                  {t.dateLabel}{t.startTime ? <> בשעה <span dir="ltr">{t.startTime}</span></> : null}
                </p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); dismissToast(t.id); }}
                aria-label="סגור"
                className="flex-shrink-0 text-neutral-300 hover:text-neutral-500 text-lg leading-none"
              >×</button>
            </div>
            );
          })}
        </div>
      )}

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
                const isWait   = e.type === "waitlist";
                const verb = isCancel ? "ביטל/ה תור" : isWait ? "נרשם/ה לרשימת המתנה" : "קבע/ה תור";
                const main = isOwner && e.staffName
                  ? `${e.customerName} ${verb} אצל ${e.staffName}`
                  : `${e.customerName} ${verb}`;
                const icon = isCancel ? "✕" : isWait ? "⏳" : "📅";
                const iconBg = isCancel ? "bg-red-100" : isWait ? "bg-amber-100" : "bg-teal-100";
                return (
                  <li key={e.id} className={`px-4 py-3 flex gap-3 ${e.unread ? "bg-teal-50/60" : ""}`}>
                    <span className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm ${iconBg}`}>
                      {icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-neutral-800 leading-snug">{main}</p>
                      <p className="text-[12px] text-neutral-500 mt-0.5 leading-snug">
                        {e.serviceName && <span>{e.serviceName} · </span>}
                        {e.dateLabel}{e.startTime ? <> בשעה <span dir="ltr">{e.startTime}</span></> : null}
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
