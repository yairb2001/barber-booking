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
  { href: "/admin/crm/leads", label: "לידים" },
  { href: "/admin/crm/calendar", label: "יומן שיחות" },
  { href: "/admin/crm/customers", label: "לקוחות" },
  { href: "/admin/crm/invoices", label: "חשבוניות" },
  { href: "/admin/crm/automations", label: "אוטומציות" },
  { href: "/admin/crm/settings", label: "הגדרות" },
];

export default function CrmShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/api/admin/me").then(r => (r.ok ? r.json() : null)).then(me => {
      if (!me) { router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`); return; }
      setAllowed(!!me.isSuperAdmin);
    }).catch(() => setAllowed(false));
    // Checked once on entry; later navigation inside the CRM keeps the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  if (allowed === null) return <div dir="rtl" className="min-h-screen flex items-center justify-center text-slate-500 font-heebo" style={{ background: C.ground }}>טוען…</div>;
  if (!allowed) return <div dir="rtl" className="min-h-screen flex items-center justify-center text-slate-600 font-heebo" style={{ background: C.ground }}>ה-CRM פתוח רק לבעל הפלטפורמה.</div>;

  const active = (h: string, exact?: boolean) => (exact ? pathname === h : pathname.startsWith(h));
  return (
    <div dir="rtl" className="min-h-screen flex flex-col md:flex-row font-heebo" style={{ background: C.ground, color: C.ink }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&display=swap" rel="stylesheet" />
      <nav aria-label="תפריט CRM" className="md:w-[232px] md:shrink-0 md:min-h-screen flex flex-col" style={{ background: C.petrol, color: "#E8F4F1" }}>
        <div className="flex items-center justify-between px-5 py-4 md:py-6">
          <Link href="/admin/crm" className="flex items-baseline gap-2" style={{ textDecoration: "none" }}>
            <span className="text-[26px] font-bold text-white" style={{ fontFamily: "Outfit, Heebo, sans-serif", letterSpacing: "-0.5px" }}>Chator</span>
            <span className="text-xs font-semibold tracking-widest" style={{ color: C.turquoise }}>CRM</span>
          </Link>
          <button type="button" className="md:hidden h-11 px-3 rounded-lg text-sm border" style={{ borderColor: "#36585A" }} onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen}>תפריט</button>
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
