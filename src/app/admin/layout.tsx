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
  superOnly?: boolean; // only for the platform owner (super-admin)
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
  { href: "/admin/super",        label: "פלטפורמה",       icon: "🛰️", superOnly: true },
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
  const [me, setMe] = useState<{ isOwner: boolean; staff?: { name: string } | null; chatsEnabled?: boolean; barbersCanAccessChats?: boolean; referralProgramEnabled?: boolean; onboardingCompletedAt?: string | null; whatsappDown?: boolean; isSuperAdmin?: boolean; impersonating?: boolean; publicPath?: string; slug?: string | null } | null>(null);
  const [unreadChats, setUnreadChats] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
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

  // Re-poll /api/admin/me on a 60s cadence (only when the tab is visible) so the
  // "WhatsApp disconnected" banner surfaces on its own — no manual refresh. Paired
  // with the live send-failure reconciliation, the alert appears within ~a minute.
  useEffect(() => {
    if (pathname === "/admin/login" || pathname.startsWith("/admin/onboarding")) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      fetch("/api/admin/me")
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (!cancelled && data) setMe(data); })
        .catch(() => {});
    };
    const id = setInterval(tick, 60000);
    document.addEventListener("visibilitychange", tick);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener("visibilitychange", tick); };
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
        .then((list: { needsHandling?: boolean }[]) => {
          if (cancelled) return;
          // Red badge = number of conversations that still NEED HANDLING — i.e.
          // human-handled chats where the customer spoke last and you haven't
          // replied yet. Agent-handled chats, and ones you've already replied
          // to, never count — no nagging once it's dealt with.
          const total = Array.isArray(list) ? list.filter(c => c.needsHandling).length : 0;
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
    if (item.superOnly && !me?.isSuperAdmin) return false;
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

  const stopImpersonating = async () => {
    await fetch("/api/admin/super/impersonate", { method: "DELETE" });
    window.location.href = "/admin/super";
  };

  // Share / copy the public booking link so the owner can distribute it easily.
  const handleShareLink = async () => {
    const url = window.location.origin + (me?.publicPath || "/");
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
            href={me?.publicPath || "/"}
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
            EVERY staff member (owner OR barber) gets the reconnect button so
            whoever is around can scan the QR and restore the shared line. */}
        {me?.impersonating && (
          <div className="shrink-0 bg-blue-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
            <span className="font-bold leading-tight flex items-center gap-2"><span>👁️</span>מחובר כמנהל של עסק אחר (מצב צפייה)</span>
            <button onClick={stopImpersonating} className="shrink-0 bg-white text-blue-700 font-bold rounded-lg px-3 py-1.5 hover:bg-blue-50 transition whitespace-nowrap">חזרה לפלטפורמה ←</button>
          </div>
        )}
        {me?.whatsappDown && (
          <div className="shrink-0 animate-alert-blink text-white px-4 py-2.5 flex items-center justify-between gap-3 text-sm shadow-md">
            <span className="font-bold leading-tight flex items-center gap-2">
              <span className="animate-pulse text-base">🔴</span>
              הוואטסאפ מנותק — הלקוחות לא מקבלים מענה אוטומטי
            </span>
            <button
              onClick={() => setQrOpen(true)}
              className="shrink-0 bg-white text-red-700 font-bold rounded-lg px-3 py-1.5 hover:bg-red-50 transition whitespace-nowrap"
            >
              חבר מחדש ←
            </button>
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

      {/* WhatsApp reconnect QR — available to every staff member from the banner */}
      {qrOpen && <WhatsAppReconnectModal onClose={() => setQrOpen(false)} />}
    </div>
  );
}

// ── WhatsApp reconnect modal ─────────────────────────────────────────────────
// Self-contained QR flow opened from the disconnected banner. Polls
// /api/admin/whatsapp/qr (now open to owner AND barbers) and shows a fresh
// linking QR that rotates ~every 20s. Anyone on staff can scan it from the
// business phone to restore the shared WhatsApp line.
type QrState = { state?: string; connected?: boolean; qr?: string; type?: string; error?: string };
function WhatsAppReconnectModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<QrState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch("/api/admin/whatsapp/qr", { cache: "no-store" });
        const d: QrState = await res.json();
        if (cancelled) return;
        setData(d);
        setLoading(false);
        if (!d.connected) timer = setTimeout(tick, 15000); // QR rotates — re-poll
      } catch {
        if (cancelled) return;
        setData({ error: "network" });
        setLoading(false);
        timer = setTimeout(tick, 15000);
      }
    }
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔗</span>
            <h2 className="font-bold text-neutral-800">חיבור WhatsApp מחדש</h2>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 text-xl leading-none">✕</button>
        </div>

        {data?.connected ? (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-5 text-center">
            <div className="text-3xl mb-1">✓</div>
            <p className="text-sm font-semibold text-emerald-800">ה-WhatsApp מחובר ופעיל</p>
            <p className="text-[11px] text-emerald-600 mt-1">המספר מקושר — הודעות יישלחו כרגיל.</p>
          </div>
        ) : data?.qr ? (
          <div className="text-center">
            <div className="inline-block rounded-xl border border-neutral-200 p-3 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.qr} alt="WhatsApp QR" width={240} height={240} className="block" />
            </div>
            <p className="text-sm font-medium text-neutral-700 mt-3">סרקו את הקוד מ-WhatsApp במכשיר העסק</p>
            <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
              WhatsApp ← הגדרות ← מכשירים מקושרים ← קישור מכשיר.
              <br />הקוד מתחדש אוטומטית — אם פג, ימתין קוד חדש.
            </p>
          </div>
        ) : data?.error ? (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 text-center">
            לא הצלחנו לטעון את החיבור ({data.error}). נסו שוב בעוד רגע או פנו למנהל.
          </div>
        ) : (
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-6 text-sm text-slate-500 text-center">
            {loading ? "טוען חיבור..." : "ממתין לחיבור..."}
          </div>
        )}
      </div>
    </div>
  );
}
