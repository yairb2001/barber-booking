"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { C } from "./ui";
import { CardHost } from "./CardModal";
import { AREAS, areaOf, CrmScope } from "./Areas";

/**
 * Chator CRM shell — direction A ("חדר בקרה", chosen 9.10.2026): a petrol side
 * menu + content. Platform owner only; the API refuses anyone else too.
 * Design: claude.ai/artifact/SgzjBxsYrqHDE2HKJtEvDz.
 */

// Six areas (26.10.2026): see Areas.tsx. A reports member sees only the reports.
const REPORTS_ONLY = [{ key: "reports", label: "דיווחים", href: "/admin/crm/reports", icon: null as React.ReactNode }];
// The phone's bottom bar: the four daily areas, and "עוד" (the side menu) for numbers and settings.
const BAR = ["today", "chats", "customers", "sales"];

export default function CrmShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  // A reports member (25.10.2026) sees only "דיווחים"; Yair and an "admin" member (Nika) see everything.
  const [member, setMember] = useState<string | null>(null);
  const [memberName, setMemberName] = useState<string | null>(null); // any member: her name and logout at the bottom
  const [menuOpen, setMenuOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [requests, setRequests] = useState(0); // shops' requests not seen yet
  const [reports, setReports] = useState(0); // new reports on the agent, not looked at yet

  useEffect(() => {
    fetch("/api/admin/crm?view=whoami", { cache: "no-store" }).then(async r => {
      if (r.status === 401) { router.replace(pathname.startsWith("/admin/crm/reports") ? "/crm-login" : `/admin/login?next=${encodeURIComponent(pathname)}`); return; }
      const me = r.ok ? await r.json() : null;
      if (me?.member) setMemberName(me.name || "צוות");
      if (me?.role === "reports") {
        setMember(me.name || "צוות");
        if (!pathname.startsWith("/admin/crm/reports")) router.replace("/admin/crm/reports");
      }
      setAllowed(me?.role === "admin" || me?.role === "reports");
    }).catch(() => setAllowed(false));
    // Checked once on entry; later navigation inside the CRM keeps the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  // The bell: unread notifications, refreshed on every screen change and when
  // a screen marks something read (bumpBell in HomeParts). Not for a member.
  useEffect(() => {
    if (member || allowed !== true) return;
    const load = () => fetch("/api/admin/crm?view=badge", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(j => { if (j && typeof j.unread === "number") setUnread(j.unread); if (j && typeof j.requests === "number") setRequests(j.requests); if (j && typeof j.reports === "number") setReports(j.reports); }).catch(() => {});
    void load();
    window.addEventListener("crm:bell", load);
    return () => window.removeEventListener("crm:bell", load);
  }, [pathname, member, allowed]);
  // Safari's "Add to Home Screen" takes the manifest of the page as it was
  // first LOADED. Reaching the CRM by in-app navigation (the bookings app's
  // menu, or the login page) leaves the bookings app's manifest in force and
  // the shortcut opened the bookings calendar (10.10.2026, twice). In the
  // browser, enter the CRM with a real page load once.
  useEffect(() => {
    try {
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
      if (standalone) return;
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const first = nav ? new URL(nav.name).pathname : "";
      if (first && !first.startsWith("/admin/crm")) window.location.replace(window.location.href);
    } catch { /* ignore */ }
  }, []);

  if (allowed === null) return <div dir="rtl" className="min-h-screen flex items-center justify-center text-slate-500 font-heebo" style={{ background: C.ground }}>טוען…</div>;
  if (!allowed) return <div dir="rtl" className="min-h-screen flex items-center justify-center text-slate-600 font-heebo" style={{ background: C.ground }}>ה-CRM פתוח רק לבעל הפלטפורמה.</div>;

  const current = member ? "reports" : areaOf(pathname)?.key;
  const nav = member ? REPORTS_ONLY : AREAS;
  const badge = (key: string) => (key === "customers" ? requests + reports : 0);
  const links = (
    <>
      {nav.map(n => {
        const on = current === n.key;
        return (
          <Link key={n.key} href={n.href} onClick={() => setMenuOpen(false)} aria-current={on ? "page" : undefined} className="px-3 py-3 rounded-[10px] text-[15px] flex items-center gap-3" style={{ background: on ? C.petrol2 : "transparent", color: on ? "#fff" : "#CFE3DF", fontWeight: on ? 600 : 400, textDecoration: "none" }}>
            {n.icon && <span style={{ color: on ? C.turquoise : "#8FB8B0" }}>{n.icon}</span>}
            {n.label}
            {badge(n.key) > 0 && <span className="ms-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold" style={{ background: C.coral, color: C.ink, fontFamily: "Outfit, Heebo, sans-serif" }}>{badge(n.key)}</span>}
          </Link>
        );
      })}
      <div className="mt-auto pt-4 border-t flex flex-col gap-2 px-2" style={{ borderColor: "#1E5C5B" }}>
        {memberName ? (
          <>
            <span className="text-[13px]" style={{ color: "#A9C9C4" }}>מחוברת: {memberName}</span>
            <a href="/api/crm-logout" className="text-[13px]" style={{ color: "#A9C9C4" }}>יציאה</a>
          </>
        ) : (
          <>
            <Link href="/admin/super" className="text-[13px]" style={{ color: "#A9C9C4" }}>מסך הפלטפורמה הישן</Link>
            <Link href="/admin" className="text-[13px]" style={{ color: "#A9C9C4" }}>חזרה למספרה</Link>
          </>
        )}
      </div>
    </>
  );
  return (
    <CrmScope.Provider value={{ member: !!member, requests, reports }}>
    <div dir="rtl" className="min-h-screen flex flex-col md:flex-row font-heebo" style={{ background: C.ground, color: C.ink }}>
      {/* A screen with its own bottom bar (a chat's composer, a save bar) marks itself data-no-tabbar: the phone's bar steps aside. */}
      <style>{`@media (max-width: 767px){body:has([data-no-tabbar]) .crm-tabbar{display:none}body:has([data-no-tabbar]) .crm-main{padding-bottom:1.25rem}}`}</style>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&display=swap" rel="stylesheet" />
      <nav aria-label="תפריט CRM" className="sticky top-0 z-30 md:w-[232px] md:shrink-0 md:h-screen md:overflow-y-auto flex flex-col" style={{ background: C.petrol, color: "#E8F4F1" }}>
        {/* Phone: menu button on the right (start), logo on the left (Yair, 10.10.2026). */}
        <div className="flex items-center justify-between px-4 py-3 md:px-5 md:py-6">
          <div className="flex items-center gap-1">
            {member && <button type="button" className="md:hidden w-11 h-11 -ms-1 rounded-lg inline-flex items-center justify-center" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-label="תפריט">
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>}
            {!member && (
              <Link href="/admin/crm/alerts" className="relative w-11 h-11 rounded-lg inline-flex items-center justify-center" style={{ color: pathname.startsWith("/admin/crm/alerts") ? C.turquoise : "#E8F4F1" }} aria-label={unread ? `התראות, ${unread} חדשות` : "התראות"}>
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                {unread > 0 && <span className="absolute top-1 end-1 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold inline-flex items-center justify-center" style={{ background: C.coral, color: C.ink, fontFamily: "Outfit, Heebo, sans-serif" }}>{unread > 99 ? "99+" : unread}</span>}
              </Link>
            )}
          </div>
          <Link href="/admin/crm" className="flex items-baseline gap-2" style={{ textDecoration: "none" }} dir="ltr">
            <span className="text-[24px] md:text-[26px] font-bold text-white" style={{ fontFamily: "Outfit, Heebo, sans-serif", letterSpacing: "-0.5px" }}>Chator</span>
            <span className="text-xs font-semibold tracking-widest" style={{ color: C.turquoise }}>CRM</span>
          </Link>
        </div>
        {/* Desktop: the side menu, always open. */}
        <div className="hidden md:flex flex-col gap-1 px-3 pb-4 flex-1">{links}</div>
      </nav>
      {/* Phone: the menu slides in from the side, full height (Yair, 10.10.2026). */}
      <div className={`md:hidden fixed inset-0 z-40 ${menuOpen ? "" : "pointer-events-none"}`} aria-hidden={!menuOpen}>
        <div className={`absolute inset-0 transition-opacity duration-200 ${menuOpen ? "opacity-100" : "opacity-0"}`} style={{ background: "rgba(11,31,33,0.45)" }} onClick={() => setMenuOpen(false)} />
        <aside className={`absolute top-0 right-0 h-full w-[80%] max-w-[300px] flex flex-col transition-transform duration-200 ${menuOpen ? "translate-x-0" : "translate-x-full"}`} style={{ background: C.petrol, color: "#E8F4F1" }}>
          <div className="flex items-center justify-between px-4 py-3">
            <button type="button" className="w-11 h-11 -ms-1 rounded-lg inline-flex items-center justify-center" onClick={() => setMenuOpen(false)} aria-label="סגור תפריט">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <span className="flex items-baseline gap-2" dir="ltr">
              <span className="text-[22px] font-bold text-white" style={{ fontFamily: "Outfit, Heebo, sans-serif", letterSpacing: "-0.5px" }}>Chator</span>
              <span className="text-xs font-semibold tracking-widest" style={{ color: C.turquoise }}>CRM</span>
            </span>
          </div>
          <nav aria-label="תפריט CRM" className="flex flex-col gap-1 px-3 pb-6 flex-1 overflow-y-auto">{links}</nav>
        </aside>
      </div>
      <main className={`crm-main flex-1 min-w-0 px-4 pt-5 md:px-8 md:py-7 ${member ? "pb-5" : "pb-28"}`}>{children}</main>
      {!member && (
        <nav aria-label="אזורים" className="crm-tabbar md:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-5 bg-white" style={{ borderTop: `1px solid ${C.line}`, paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
          {[...AREAS.filter(a => BAR.includes(a.key)), { key: "more", label: "עוד", href: "", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg> }].map(a => {
            const on = a.key === "more" ? menuOpen || current === "numbers" || current === "settings" : current === a.key;
            const inner = (
              <>
                {a.icon}
                <span className="text-[11px]" style={{ fontWeight: on ? 700 : 500 }}>{a.label}</span>
                {badge(a.key) > 0 && <span className="absolute top-1 start-[calc(50%+6px)] min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold inline-flex items-center justify-center" style={{ background: C.coral, color: C.ink, fontFamily: "Outfit, Heebo, sans-serif" }}>{badge(a.key)}</span>}
              </>
            );
            const cls = "relative flex flex-col items-center gap-0.5 pt-2 pb-1 min-h-[52px]";
            const style = { color: on ? C.petrol : C.muted, textDecoration: "none" };
            return a.key === "more"
              ? <button key="more" type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} className={cls} style={style}>{inner}</button>
              : <Link key={a.key} href={a.href} aria-current={on ? "page" : undefined} className={cls} style={style}>{inner}</Link>;
          })}
        </nav>
      )}
      <CardHost />
    </div>
    </CrmScope.Provider>
  );
}
