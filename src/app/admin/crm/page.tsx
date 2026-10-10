"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { C, NUM, TONE, PageHead, useCrm } from "./ui";
import { CrmPushBanner } from "./CrmPush";
import { Numbers, greeting, type Home } from "./HomeParts";

/**
 * CRM home = the dashboard (10.10.2026, Yair: "הבית יהיה הדשבורד"). Today in
 * three tiles (each opens its own screen), then the business numbers. Tasks
 * have their own page in the menu, notifications sit behind the bell.
 */
function CrmHomeInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { data, error, loading } = useCrm<Home>("view=home");
  // Old links (push, WhatsApp) still point at ?tab=…
  useEffect(() => {
    const t = sp.get("tab");
    if (t === "alerts" || t === "tasks") router.replace(`/admin/crm/${t}`);
  }, [sp, router]);
  const today = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" }).format(new Date());

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>{loading ? "טוען…" : ""}</p>;

  const open = data.tasks.filter(t => !t.done);
  const overdue = open.filter(t => t.overdue).length;
  const calls = data.callsToday.filter(c => c.booked).length;
  const tiles = [
    { href: "/admin/crm/tasks", label: "משימות פתוחות", n: open.length, sub: overdue ? `${overdue} באיחור` : open.length ? "" : "השולחן נקי", bad: overdue > 0 },
    { href: "/admin/crm/calendar", label: "שיחות היום", n: calls, sub: data.callsToday.find(c => c.booked)?.time ? `הבאה ב-${data.callsToday.find(c => c.booked)!.time}` : "", bad: false },
    { href: "/admin/crm/alerts", label: "התראות חדשות", n: data.unread, sub: "", bad: false },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHead title={`${greeting()}, יאיר`} sub={today} actions={<Link href="/admin/crm/leads?new=1" className="min-h-[44px] px-4 rounded-xl text-sm font-bold inline-flex items-center" style={{ background: C.coral, color: C.ink, textDecoration: "none" }}>+ ליד חדש</Link>} />
      <CrmPushBanner />
      <section aria-label="היום" className="grid grid-cols-3 gap-2">
        {tiles.map(t => (
          <Link key={t.href} href={t.href} className="rounded-2xl px-3 py-3 flex flex-col gap-0.5 min-w-0" style={{ background: "#fff", border: `1px solid ${C.line}`, color: C.ink, textDecoration: "none" }}>
            <span className="text-[12px] leading-tight" style={{ color: C.muted }}>{t.label}</span>
            <span className="text-[26px] font-bold leading-tight" style={{ ...NUM, color: C.petrol }}>{t.n}</span>
            {t.sub && <span className="text-[11px] font-medium truncate" style={{ color: t.bad ? TONE.bad.color : C.muted }}>{t.sub}</span>}
          </Link>
        ))}
      </section>
      <Numbers data={data} />
    </div>
  );
}

export default function CrmHome() {
  return <Suspense fallback={<p style={{ color: C.muted }}>טוען…</p>}><CrmHomeInner /></Suspense>;
}
