"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useNativeShell } from "@/lib/native/useNativeShell";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
  ownerOnly?: boolean;
  barberOnly?: boolean;
  requiresChats?: boolean;  // only shown when business.chatsEnabled === true
  requiresReferral?: boolean; // only shown when the referral program is enabled
};

// Pages that live "inside" Business Settings — the Settings nav item stays highlighted on these
const SETTINGS_SUB_PATHS = [
  "/admin/staff",
  "/admin/services",
  "/admin/templates",
  "/admin/stories",
  "/admin/products",
  "/admin/announcements",
  "/admin/portfolio",
];

// Pages that live "inside" Barber Settings — the Barber-Settings nav item stays highlighted
const BARBER_SETTINGS_SUB_PATHS = [
  "/admin/barber-settings",
];

// Sidebar — flat list. Everything that's a sub-page of settings is reached from inside /admin/settings.
const navItems: NavItem[] = [
  { href: "/admin",              label: "יומן",           icon: "📅", exact: true },
  { href: "/admin/dashboard",    label: "דאשבורד",        icon: "📊" },
  { href: "/admin/chats",        label: "שיחות",          icon: "💬", requiresChats: true },
  { href: "/admin/customers",    label: "לקוחות",         icon: "👥" },
  { href: "/admin/referrals",    label: "חבר מביא חבר",   icon: "🤝", requiresReferral: true },
  { href: "/admin/messaging",    label: "הודעות תפוצה",   icon: "📢" },
  { href: "/admin/agent",        label: "סוכן AI",        icon: "🤖", ownerOnly: true },
  { href: "/admin/staff",             label: "הפרופיל",        icon: "👤", barberOnly: true },
  { href: "/admin/barber-settings",   label: "הגדרות שלי",     icon: "⚙️", barberOnly: true },
  { href: "/admin/settings",          label: "הגדרות עסק",     icon: "⚙️", ownerOnly: true },
  { href: "/admin/preview",      label: "תצוגת לקוח",     icon: "👁️" },
];

// Bottom nav (mobile)
const bottomNavOwner: NavItem[] = [
  { href: "/admin",           label: "יומן",    icon: "📅", exact: true },
  { href: "/admin/customers", label: "לקוחות",  icon: "👥" },
  { href: "/admin/messaging", label: "שיווק",   icon: "📢" },
  { href: "/admin/settings",  label: "הגדרות",  icon: "⚙️" },
];
const bottomNavBarber: NavItem[] = [
  { href: "/admin",                   label: "יומן",    icon: "📅", exact: true },
  { href: "/admin/customers",         label: "לקוחות",  icon: "👥" },
  { href: "/admin/messaging",         label: "שיווק",   icon: "📢" },
  { href: "/admin/barber-settings",   label: "הגדרות",  icon: "⚙️" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [me, setMe] = useState<{ isOwner: boolean; staff?: { name: string } | null; chatsEnabled?: boolean; barbersCanAccessChats?: boolean; referralProgramEnabled?: boolean; onboardingCompletedAt?: string | null; whatsappDown?: boolean } | null>(null);
  const [unreadChats, setUnreadChats] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  // Initialise the native shell — registers push, sets status bar.
  // No-op on the regular web browser.
  const { platform } = useNativeShell();
  const isNative = platform === "ios" || platform === "android";

  useEffect(() => {
    if (pathname === "/admin/login" || pathname.startsWith("/admin/onboarding")) return;
    fetch("/api/admin/me")
      .then(r => r.ok ? r.json() : null)
      .then(setMe)
      .catch(() => setMe(null));
  }, [pathname]);

  // Gate: a freshly-signed-up owner who hasn't finished onboarding is sent to
  // the wizard. Barbers and onboarded owners are unaffected. The wizard itself
  // and the login page are excluded to avoid a redirect loop.
  useEffect(() => {
    if (!me) return;
    if (pathname === "/admin/login" || pathname.startsWith("/admin/onboarding")) return;
    if (me.isOwner && !me.onboardingCompletedAt) {
      router.replace("/admin/onboarding");
    }
  }, [me, pathname, router]);

  // Poll unread chats count when chats feature is on (only when tab visible).
  // 15s interval — light DB hit (single COUNT query per business).
  const chatsEnabled = me?.chatsEnabled ?? false;
  const isOwnerForChats = me?.isOwner ?? true;
  const showChats = chatsEnabled && (isOwnerForChats || (me?.barbersCanAccessChats ?? false));
  useEffect(() => {
    if (!showChats || pathname === "/admin/login") return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      fetch("/api/admin/chats")
        .then(r => r.ok ? r.json() : [])
        .then((list: { unreadCount: number }[]) => {
          if (cancelled) return;
          const total = Array.isArray(list) ? list.reduce((s, c) => s + (c.unreadCount || 0), 0) : 0;
          setUnreadChats(total);
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [showChats, pathname]);

  const isOwner = me?.isOwner ?? true; // optimistic — show full menu while loading, API will reject any forbidden actions

  const referralEnabled = me?.referralProgramEnabled ?? false;
  const visibleNav = navItems.filter(item => {
    if (item.ownerOnly && !isOwner) return false;
    if (item.barberOnly && isOwner) return false;
    if (item.requiresChats && !showChats) return false;
    if (item.requiresReferral && !referralEnabled) return false;
    return true;
  });
  // Bottom nav: only show "שיחות" if feature enabled — otherwise drop in favor of fallback
  const bottomNavBase = isOwner ? bottomNavOwner : bottomNavBarber;
  const bottomNav = showChats
    ? [
        bottomNavBase[0], // יומן
        { href: "/admin/chats", label: "שיחות", icon: "💬" } as NavItem,
        ...bottomNavBase.slice(1, 3), // לקוחות, שיווק
        bottomNavBase[3], // הגדרות / הפרופיל
      ]
    : bottomNavBase;

  if (pathname === "/admin/login") {
    return <div className="min-h-screen bg-slate-50 text-slate-900 font-heebo" dir="rtl">{children}</div>;
  }

  // Onboarding wizard renders full-screen without the admin chrome.
  if (pathname.startsWith("/admin/onboarding")) {
    return <>{children}</>;
  }

  const handleLogout = async () => {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    window.location.href = "/admin/login";
  };

  // Share / copy the public booking link so the owner can distribute it easily.
  const handleShareLink = async () => {
    const url = window.location.origin + "/";
    const title = "DOMINANT — קביעת תור";
    // Prefer the native share sheet (mobile / installed app), fall back to clipboard.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* user cancelled or share unavailable — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      window.prompt("העתק את קישור העסק:", url);
    }
  };

  const isActive = (item: { href: string; exact?: boolean }) => {
    // Sub-pages of business settings keep "הגדרות עסק" highlighted
    if (item.href === "/admin/settings" && SETTINGS_SUB_PATHS.some(p => pathname.startsWith(p))) return true;
    // Sub-pages of barber settings keep "הגדרות שלי" highlighted
    if (item.href === "/admin/barber-settings" && BARBER_SETTINGS_SUB_PATHS.some(p => pathname.startsWith(p))) return true;
    return item.exact ? pathname === item.href : pathname.startsWith(item.href);
  };

  const currentLabel = visibleNav.find(isActive)?.label ?? "ניהול";

  return (
    <div className="admin-shell flex h-[100dvh] overflow-hidden bg-slate-50 text-slate-900 font-heebo" dir="rtl">

      {/* ── Mobile drawer backdrop ── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Sidebar — desktop always visible, mobile slides from right ── */}
      <aside className={`
        fixed top-0 right-0 h-full z-50 w-64 bg-white flex flex-col
        border-l border-slate-200
        transition-transform duration-200 ease-in-out
        ${drawerOpen ? "translate-x-0" : "translate-x-full"}
        md:w-52 md:translate-x-0 md:z-10
      `}>
        <div className="px-4 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-slate-900 font-bold text-base tracking-tight">DOMINANT</div>
            <div className="text-slate-500 text-xs">
              {me ? (isOwner ? "מנהל ראשי" : `שלום ${me.staff?.name || "ספר"}`) : "ניהול מספרה"}
            </div>
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="md:hidden text-slate-500 hover:text-slate-900 transition text-lg p-1 rounded-lg hover:bg-slate-100"
            aria-label="סגור תפריט"
          >
            ✕
          </button>
        </div>

        <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
          {visibleNav.map((item) => {
            const isChats = item.href === "/admin/chats";
            const showBadge = isChats && unreadChats > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setDrawerOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition ${
                  isActive(item)
                    ? "bg-teal-50 text-teal-700 font-semibold"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
                {showBadge && (
                  <span className="mr-auto bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center">
                    {unreadChats > 99 ? "99+" : unreadChats}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-3 border-t border-slate-200 space-y-2">
          {/* Share the public booking link — easy to distribute to customers */}
          <button
            onClick={handleShareLink}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
              linkCopied ? "bg-emerald-50 text-emerald-700" : "bg-teal-50 text-teal-700 hover:bg-teal-100"
            }`}
          >
            <span className="text-base">{linkCopied ? "✓" : "🔗"}</span>
            <span>{linkCopied ? "הקישור הועתק!" : "קישור העסק — שתף"}</span>
          </button>
          <Link
            href="/"
            onClick={() => setDrawerOpen(false)}
            className="block text-xs text-slate-500 hover:text-slate-700 transition"
          >
            ← האתר ללקוחות
          </Link>
          <button
            onClick={handleLogout}
            className="text-xs text-red-500 hover:text-red-600 transition"
          >
            🚪 יציאה
          </button>
        </div>
      </aside>

      {/* ── Content area ── */}
      <div className="flex flex-col flex-1 min-w-0 h-[100dvh] md:mr-52">

        {/* WhatsApp disconnected banner — visible on every admin page.
            Barbers see the warning; owners also get a link to reconnect (QR). */}
        {me?.whatsappDown && (
          <div className="shrink-0 bg-red-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
            <span className="font-medium leading-tight">
              🔴 הוואטסאפ מנותק — הלקוחות לא מקבלים מענה אוטומטי
            </span>
            {isOwner && (
              <Link
                href="/admin/settings?tab=whatsapp"
                className="shrink-0 bg-white text-red-700 font-semibold rounded-lg px-3 py-1.5 hover:bg-red-50 transition whitespace-nowrap"
              >
                חבר מחדש ←
              </Link>
            )}
          </div>
        )}

        {/* Mobile top header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white text-slate-900 shrink-0 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-900 font-bold text-sm shrink-0 tracking-tight">DOMINANT</span>
            <span className="text-slate-300 text-xs shrink-0">·</span>
            <span className="text-slate-600 text-sm truncate">{currentLabel}</span>
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-slate-500 hover:text-slate-900 transition p-1.5 rounded-lg hover:bg-slate-100 shrink-0 text-xl leading-none"
            aria-label="פתח תפריט"
          >
            ☰
          </button>
        </header>

        {/* Main content — fills all remaining height; bottom nav removed, navigation is via the ☰ hamburger */}
        <main className="flex-1 overflow-auto min-h-0">{children}</main>
      </div>
    </div>
  );
}
