"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext } from "react";
import { C, NUM } from "./ui";

/**
 * The CRM in six areas (26.10.2026, Yair: "סדר מופתי ... אשתי הולכת לנהל זאת והיא
 * לא אוהבת בלאגן"). The side menu (and the phone's bottom bar) shows the areas;
 * an area's screens are tabs at its top. Design: agents/dev-chator/עיצובים/תפעול.
 */
type Tab = { href: string; label: string; badge?: "requests" | "reports" };
export type Area = { key: string; label: string; href: string; icon: React.ReactNode; tabs: Tab[]; also?: string[] };

const svg = (d: React.ReactNode) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;

export const AREAS: Area[] = [
  { key: "today", label: "היום", href: "/admin/crm", icon: svg(<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>), tabs: [], also: ["/admin/crm/tasks", "/admin/crm/alerts"] },
  { key: "chats", label: "צ׳אטים", href: "/admin/crm/chats", icon: svg(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />), tabs: [] },
  {
    key: "customers", label: "לקוחות", href: "/admin/crm/customers", icon: svg(<><path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" /><path d="M3 9h18" /><path d="M10 20v-6h4v6" /></>),
    // "בקשות מעסקים" became פניות; reports and agent improvements were one queue, it stays one (under reports).
    tabs: [{ href: "/admin/crm/customers", label: "עסקים" }, { href: "/admin/crm/requests", label: "פניות", badge: "requests" }, { href: "/admin/crm/reports", label: "דיווחים על הסוכן", badge: "reports" }],
    also: ["/admin/crm/improvements"],
  },
  {
    key: "sales", label: "מכירות", href: "/admin/crm/whatsapp", icon: svg(<><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>),
    // Two categories (Yair 26.10): the agent's funnel, and real leads. Only real leads count as leads.
    tabs: [{ href: "/admin/crm/whatsapp", label: "אוטומטי" }, { href: "/admin/crm/leads", label: "לידים אמיתיים" }],
    also: ["/admin/crm/calendar"],
  },
  { key: "numbers", label: "מספרים", href: "/admin/crm/numbers", icon: svg(<><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>), tabs: [{ href: "/admin/crm/numbers", label: "הכנסות" }, { href: "/admin/crm/invoices", label: "חשבוניות" }] },
  { key: "settings", label: "הגדרות", href: "/admin/crm/settings", icon: svg(<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>), tabs: [{ href: "/admin/crm/settings", label: "כללי" }, { href: "/admin/crm/automations", label: "אוטומציות" }, { href: "/admin/crm/wa-funnel", label: "הודעות המשפך" }] },
];

const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`) || path.startsWith(`${href}?`);
export function areaOf(path: string): Area | null {
  const [today, ...rest] = AREAS;
  if (path === today.href || today.also!.some(h => under(path, h))) return today;
  return rest.find(a => [a.href, ...a.tabs.map(t => t.href), ...(a.also ?? [])].some(h => under(path, h))) ?? null;
}

/** Who is in (a reports member sees only the reports) and the counts on the menu, from CrmShell. */
export const CrmScope = createContext<{ member: boolean; requests: number; reports: number }>({ member: false, requests: 0, reports: 0 });
export const useCrmScope = () => useContext(CrmScope);

/** The area's tabs, under its title. Nothing for a one-screen area or a reports member. */
export function AreaTabs() {
  const path = usePathname();
  const scope = useCrmScope();
  const area = areaOf(path);
  if (!area || area.tabs.length < 2 || scope.member) return null;
  return (
    <nav aria-label={area.label} className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1" style={{ scrollbarWidth: "none" }}>
      {area.tabs.map(t => {
        const on = under(path, t.href);
        const n = t.badge ? scope[t.badge] : 0;
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} className="shrink-0 h-11 px-4 rounded-full text-[15px] font-bold inline-flex items-center gap-2"
            style={on ? { background: C.petrol, color: "#fff", textDecoration: "none" } : { background: "#fff", color: C.muted, border: `1px solid ${C.line}`, textDecoration: "none" }}>
            {t.label}
            {n > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[12px] inline-flex items-center justify-center" style={{ ...NUM, background: on ? "rgba(255,255,255,.2)" : "#D92D20", color: "#fff" }}>{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
