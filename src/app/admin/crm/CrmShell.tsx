"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { C } from "./ui";

/**
 * Chator CRM shell — direction A ("חדר בקרה", chosen 9.10.2026): a petrol side
 * menu + content. Platform owner only; the API refuses anyone else too.
 * Design: claude.ai/artifact/SgzjBxsYrqHDE2HKJtEvDz.
 */

const NAV = [
  { href: "/admin/crm", label: "בית", exact: true },
  { href: "/admin/crm/tasks", label: "משימות" },
  { href: "/admin/crm/leads", label: "לידים" },
  { href: "/admin/crm/calendar", label: "יומן שיחות" },
  { href: "/admin/crm/customers", label: "לקוחות" },
  { href: "/admin/crm/invoices", label: "חשבוניות" },
  { href: "/admin/crm/automations", label: "אוטומציות" },
  { href: "/admin/crm/improvements", label: "שיפורי סוכן" },
  { href: "/admin/crm/settings", label: "הגדרות" },
];

export default function CrmShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    fetch("/api/admin/me").then(r => (r.ok ? r.json() : null)).then(me => {
      if (!me) { router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`); return; }
      setAllowed(!!me.isSuperAdmin);
    }).catch(() => setAllowed(false));
    // Checked once on entry; later navigation inside the CRM keeps the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  // The bell: unread notifications, refreshed on every screen change and when
  // a screen marks something read (bumpBell in HomeParts).
  useEffect(() => {
    const load = () => fetch("/api/admin/crm?view=badge", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(j => { if (j && typeof j.unread === "number") setUnread(j.unread); }).catch(() => {});
    void load();
    window.addEventListener("crm:bell", load);
    return () => window.removeEventListener("crm:bell", load);
  }, [pathname]);
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

  const active = (h: string, exact?: boolean) => (exact ? pathname === h : pathname.startsWith(h));
  return (
    <div dir="rtl" className="min-h-screen flex flex-col md:flex-row font-heebo" style={{ background: C.ground, color: C.ink }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&display=swap" rel="stylesheet" />
      <nav aria-label="תפריט CRM" className="md:w-[232px] md:shrink-0 md:min-h-screen flex flex-col" style={{ background: C.petrol, color: "#E8F4F1" }}>
        {/* Phone: menu button on the right (start), logo on the left (Yair, 10.10.2026). */}
        <div className="flex items-center justify-between px-4 py-3 md:px-5 md:py-6">
          <div className="flex items-center gap-1">
            <button type="button" className="md:hidden w-11 h-11 -ms-1 rounded-lg inline-flex items-center justify-center" onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen} aria-label="תפריט">
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
            <Link href="/admin/crm/alerts" className="relative w-11 h-11 rounded-lg inline-flex items-center justify-center" style={{ color: pathname.startsWith("/admin/crm/alerts") ? C.turquoise : "#E8F4F1" }} aria-label={unread ? `התראות, ${unread} חדשות` : "התראות"}>
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
              {unread > 0 && <span className="absolute top-1 end-1 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold inline-flex items-center justify-center" style={{ background: C.coral, color: C.ink, fontFamily: "Outfit, Heebo, sans-serif" }}>{unread > 99 ? "99+" : unread}</span>}
            </Link>
          </div>
          <Link href="/admin/crm" className="flex items-baseline gap-2" style={{ textDecoration: "none" }} dir="ltr">
            <span className="text-[24px] md:text-[26px] font-bold text-white" style={{ fontFamily: "Outfit, Heebo, sans-serif", letterSpacing: "-0.5px" }}>Chator</span>
            <span className="text-xs font-semibold tracking-widest" style={{ color: C.turquoise }}>CRM</span>
          </Link>
        </div>
        <div className={`${menuOpen ? "flex" : "hidden"} md:flex flex-col gap-1 px-3 pb-4 md:flex-1`}>
          {NAV.map(n => (
            <Link key={n.href} href={n.href} className="px-3 py-3 rounded-[10px] text-[15px]" style={{ background: active(n.href, n.exact) ? C.petrol2 : "transparent", color: active(n.href, n.exact) ? "#fff" : "#CFE3DF", fontWeight: active(n.href, n.exact) ? 600 : 400, textDecoration: "none" }}>{n.label}</Link>
          ))}
          <div className="md:mt-auto pt-4 mt-2 border-t flex flex-col gap-2 px-2" style={{ borderColor: "#1E5C5B" }}>
            <Link href="/admin/super" className="text-[13px]" style={{ color: "#A9C9C4" }}>מסך הפלטפורמה הישן</Link>
            <Link href="/admin" className="text-[13px]" style={{ color: "#A9C9C4" }}>חזרה למספרה</Link>
          </div>
        </div>
      </nav>
      <main className="flex-1 min-w-0 px-4 py-5 md:px-8 md:py-7">{children}</main>
    </div>
  );
}
