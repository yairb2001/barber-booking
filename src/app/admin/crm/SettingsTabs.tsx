"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { C } from "./ui";

/** Settings and automations, one place in the menu (15.10.2026, Yair: "אוטומציות צריכות להיות בהגדרות"). */
const TABS = [
  { href: "/admin/crm/settings", label: "כללי" },
  { href: "/admin/crm/automations", label: "אוטומציות" },
  { href: "/admin/crm/wa-funnel", label: "משפך וואטסאפ" },
];

export default function SettingsTabs() {
  const pathname = usePathname();
  return (
    <div role="tablist" aria-label="הגדרות" className="flex flex-wrap gap-2">
      {TABS.map(t => {
        const on = pathname.startsWith(t.href);
        return <Link key={t.href} href={t.href} role="tab" aria-selected={on} className="h-[38px] px-3.5 rounded-full text-sm font-semibold inline-flex items-center" style={on ? { background: C.petrol, color: "#fff", border: `1px solid ${C.petrol}`, textDecoration: "none" } : { background: "#fff", color: C.ink, border: "1px solid #C7D8D5", textDecoration: "none" }}>{t.label}</Link>;
      })}
    </div>
  );
}
