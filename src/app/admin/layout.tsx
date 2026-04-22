"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/admin", label: "יומן", icon: "📅", exact: true },
  { href: "/admin/dashboard", label: "דאשבורד", icon: "📊" },
  { href: "/admin/staff", label: "ספרים", icon: "✂️" },
  { href: "/admin/services", label: "שירותים", icon: "💈" },
  { href: "/admin/customers", label: "לקוחות", icon: "👥" },
  { href: "/admin/announcements", label: "עדכונים", icon: "📌" },
  { href: "/admin/products", label: "מוצרים", icon: "🛍️" },
  { href: "/admin/settings", label: "הגדרות", icon: "⚙️" },
  { href: "/admin/preview", label: "תצוגת לקוח", icon: "👁️" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Login page uses its own minimal layout (no sidebar)
  if (pathname === "/admin/login") {
    return <div className="min-h-screen bg-neutral-950 text-white" dir="rtl">{children}</div>;
  }

  const handleLogout = async () => {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    window.location.href = "/admin/login";
  };

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-100" dir="rtl">
      {/* Sidebar */}
      <aside className="w-52 bg-neutral-900 flex flex-col fixed h-full z-10">
        <div className="px-4 py-4 border-b border-neutral-800">
          <div className="text-amber-400 font-bold text-base">DOMINANT</div>
          <div className="text-neutral-500 text-xs">ניהול מספרה</div>
        </div>
        <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition ${
                  isActive ? "bg-amber-500 text-neutral-950 font-semibold" : "text-neutral-400 hover:bg-neutral-800 hover:text-white"
                }`}>
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-neutral-800 space-y-2">
          <Link href="/" className="block text-xs text-neutral-500 hover:text-neutral-300 transition">← האתר ללקוחות</Link>
          <button onClick={handleLogout} className="text-xs text-red-400 hover:text-red-300 transition">🚪 יציאה</button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 mr-52 h-screen overflow-auto">{children}</main>
    </div>
  );
}
