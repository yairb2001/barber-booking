"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = { href: string; label: string; icon: string; exact?: boolean; ownerOnly?: boolean };

// Full menu — `ownerOnly: true` items are hidden from barbers
const navItems: NavItem[] = [
  { href: "/admin",              label: "יומן",           icon: "📅", exact: true },
  { href: "/admin/dashboard",    label: "דאשבורד",        icon: "📊" },
  { href: "/admin/staff",        label: "ספרים",          icon: "✂️" },                    // barber sees only themselves (filtered by API)
  { href: "/admin/services",     label: "שירותים",        icon: "💈", ownerOnly: true },
  { href: "/admin/customers",    label: "לקוחות",         icon: "👥" },
  { href: "/admin/messaging",    label: "הודעות תפוצה",   icon: "📢", ownerOnly: true },
  { href: "/admin/templates",    label: "תבניות הודעות",  icon: "📝", ownerOnly: true },
  { href: "/admin/stories",      label: "סטוריז",         icon: "🎬", ownerOnly: true },
  { href: "/admin/agent",        label: "סוכן AI",        icon: "🤖", ownerOnly: true },
  { href: "/admin/announcements",label: "עדכונים",        icon: "📌", ownerOnly: true },
  { href: "/admin/products",     label: "מוצרים",         icon: "🛍️", ownerOnly: true },
  { href: "/admin/settings",     label: "הגדרות",         icon: "⚙️", ownerOnly: true },
  { href: "/admin/preview",      label: "תצוגת לקוח",    icon: "👁️" },
];

// Bottom nav (mobile)
const bottomNavOwner: NavItem[] = [
  { href: "/admin",           label: "יומן",     icon: "📅", exact: true },
  { href: "/admin/dashboard", label: "דאשבורד",  icon: "📊" },
  { href: "/admin/customers", label: "לקוחות",   icon: "👥" },
  { href: "/admin/settings",  label: "הגדרות",   icon: "⚙️" },
];
const bottomNavBarber: NavItem[] = [
  { href: "/admin",           label: "יומן",     icon: "📅", exact: true },
  { href: "/admin/dashboard", label: "דאשבורד",  icon: "📊" },
  { href: "/admin/customers", label: "לקוחות",   icon: "👥" },
  { href: "/admin/staff",     label: "הפרופיל",  icon: "👤" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [me, setMe] = useState<{ isOwner: boolean; staff?: { name: string } | null } | null>(null);

  useEffect(() => {
    if (pathname === "/admin/login") return;
    fetch("/api/admin/me")
      .then(r => r.ok ? r.json() : null)
      .then(setMe)
      .catch(() => setMe(null));
  }, [pathname]);

  const isOwner = me?.isOwner ?? true; // optimistic — show full menu while loading, API will reject any forbidden actions
  const visibleNav = navItems.filter(item => isOwner || !item.ownerOnly);
  const bottomNav = isOwner ? bottomNavOwner : bottomNavBarber;

  if (pathname === "/admin/login") {
    return <div className="min-h-screen bg-neutral-950 text-white" dir="rtl">{children}</div>;
  }

  const handleLogout = async () => {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    window.location.href = "/admin/login";
  };

  const isActive = (item: { href: string; exact?: boolean }) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  const currentLabel = visibleNav.find(isActive)?.label ?? "ניהול";

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-neutral-100 text-neutral-900" dir="rtl">

      {/* ── Mobile drawer backdrop ── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Sidebar — desktop always visible, mobile slides from right ── */}
      <aside className={`
        fixed top-0 right-0 h-full z-50 w-64 bg-neutral-900 flex flex-col
        transition-transform duration-200 ease-in-out
        ${drawerOpen ? "translate-x-0" : "translate-x-full"}
        md:w-52 md:translate-x-0 md:z-10
      `}>
        <div className="px-4 py-4 border-b border-neutral-800 flex items-center justify-between">
          <div>
            <div className="text-amber-400 font-bold text-base">DOMINANT</div>
            <div className="text-neutral-500 text-xs">
              {me ? (isOwner ? "מנהל ראשי" : `שלום ${me.staff?.name || "ספר"}`) : "ניהול מספרה"}
            </div>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="md:hidden text-neutral-500 hover:text-white transition text-lg p-1 rounded-lg hover:bg-neutral-800"
            aria-label="סגור תפריט"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
          {visibleNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setDrawerOpen(false)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition ${
                isActive(item)
                  ? "bg-amber-500 text-neutral-950 font-semibold"
                  : "text-neutral-400 hover:bg-neutral-800 hover:text-white"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-neutral-800 space-y-2">
          <Link
            href="/"
            onClick={() => setDrawerOpen(false)}
            className="block text-xs text-neutral-500 hover:text-neutral-300 transition"
          >
            ← האתר ללקוחות
          </Link>
          <button
            onClick={handleLogout}
            className="text-xs text-red-400 hover:text-red-300 transition"
          >
            🚪 יציאה
          </button>
        </div>
      </aside>

      {/* ── Content area ── */}
      <div className="flex flex-col flex-1 min-w-0 h-[100dvh] md:mr-52">

        {/* Mobile top header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-neutral-900 text-white shrink-0 border-b border-neutral-800">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-amber-400 font-bold text-sm shrink-0">DOMINANT</span>
            <span className="text-neutral-600 text-xs shrink-0">·</span>
            <span className="text-neutral-300 text-sm truncate">{currentLabel}</span>
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-neutral-400 hover:text-white transition p-1.5 rounded-lg hover:bg-neutral-800 shrink-0 text-xl leading-none"
            aria-label="פתח תפריט"
          >
            ☰
          </button>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-auto min-h-0">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden flex bg-neutral-900 border-t border-neutral-800 shrink-0 safe-bottom">
          {bottomNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition ${
                isActive(item) ? "text-amber-400" : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              <span className="text-xl leading-none">{item.icon}</span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          ))}
          {/* "More" button opens full sidebar */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-neutral-500 hover:text-neutral-300 transition"
          >
            <span className="text-xl leading-none">⋯</span>
            <span className="text-[10px] font-medium">עוד</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
