"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSlug, apiWithSlug, publicHref, useSmartBack } from "@/lib/public-nav";

function getDayName(date: Date): string {
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  return days[date.getDay()];
}
function startOfWeekSunday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function weekIndexSunday(date: Date, today: Date): number {
  const a = startOfWeekSunday(today).getTime();
  const b = startOfWeekSunday(date).getTime();
  return Math.round((b - a) / (7 * 24 * 60 * 60 * 1000));
}
// Friendly Hebrew label: היום / מחר (שני) / שני / שני שבוע הבא / שני · 7.7
function smartDateLabel(dateStr: string, today: Date): string {
  const d = new Date(dateStr + "T00:00:00");
  const diff = Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  const name = getDayName(d);
  if (diff === 0) return "היום";
  if (diff === 1) return `מחר (${name})`;
  const wk = weekIndexSunday(d, today);
  if (wk <= 0) return name;                 // later this week
  if (wk === 1) return `${name} שבוע הבא`;  // next week
  return `${name} · ${d.getDate()}.${d.getMonth() + 1}`; // 2+ weeks ahead
}

function BackArrow({ href }: { href: string }) {
  const onBack = useSmartBack(href);
  return (
    <Link href={href} onClick={onBack}
      className="w-9 h-9 flex items-center justify-center rounded-full transition-colors"
      style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)" }}>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        style={{ color: "var(--text-sec)" }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

function UpcomingPageContent() {
  const slug = useSlug();
  const searchParams = useSearchParams();
  const staffId = searchParams.get("staffId") || "";
  const serviceId = searchParams.get("serviceId") || "";

  const [today] = useState(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; });
  const [upcoming, setUpcoming] = useState<{ date: string; time: string }[]>([]);
  const [serviceName, setServiceName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!staffId || !serviceId) { setLoading(false); return; }
    setLoading(true);
    fetch(apiWithSlug(`/api/slots/upcoming?staffId=${staffId}&serviceId=${serviceId}&limit=20`, slug))
      .then(r => r.ok ? r.json() : { slots: [] })
      .then((data: { slots?: { date: string; time: string }[] }) => {
        setUpcoming(data.slots || []);
        setLoading(false);
      })
      .catch(() => { setUpcoming([]); setLoading(false); });
  }, [staffId, serviceId, slug]);

  // Service name for the brief "service" mention in the header
  useEffect(() => {
    if (!staffId || !serviceId) return;
    fetch(apiWithSlug(`/api/services?staffId=${staffId}`, slug))
      .then(r => r.ok ? r.json() : [])
      .then((svc: { id: string; name: string }[]) => {
        const found = Array.isArray(svc) ? svc.find(s => s.id === serviceId) : null;
        if (found) setServiceName(found.name);
      })
      .catch(() => { /* ignore */ });
  }, [staffId, serviceId, slug]);

  return (
    <div className="min-h-screen pb-24" dir="rtl" style={{ background: "var(--bg)" }}>
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-20 px-4 py-3"
        style={{ background: "var(--header-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--divider)" }}>
        <div className="flex items-center justify-between">
          <BackArrow href={publicHref(slug, `/book/time?staffId=${staffId}&serviceId=${serviceId}`)} />
          <div className="flex flex-col items-center gap-0.5">
            <h1 className="text-[13px] font-semibold tracking-[0.12em]" style={{ color: "var(--text-pri)" }}>
              כל התורים הקרובים
            </h1>
            {serviceName && (
              <span className="text-[10px] font-medium" style={{ color: "var(--brand)" }}>{serviceName}</span>
            )}
          </div>
          <div className="w-9" />
        </div>
      </div>

      <div className="px-4 pt-5">
        {loading ? (
          <div className="flex flex-col gap-2.5">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-14 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
            ))}
          </div>
        ) : upcoming.length > 0 ? (
          <div className="flex flex-col gap-2">
            {upcoming.map((u, i) => (
              <Link key={`${u.date}-${u.time}-${i}`}
                href={publicHref(slug, `/book/confirm?staffId=${staffId}&serviceId=${serviceId}&date=${u.date}&time=${u.time}`)}
                className="flex items-center justify-between rounded-2xl px-4 py-3.5 transition-all active:scale-[0.98]"
                style={{ background: "var(--card)", border: "1px solid var(--divider)" }}>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  style={{ color: "var(--text-muted)" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <div className="flex items-baseline gap-2.5">
                  <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                    {smartDateLabel(u.date, today)}
                  </span>
                  <span dir="ltr" className="text-[17px] font-bold tracking-widest" style={{ color: "var(--brand)" }}>
                    {u.time}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="py-20 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl"
              style={{ background: "var(--card)", border: "1px solid var(--divider)" }}>📅</div>
            <div className="text-center">
              <p className="text-sm font-semibold" style={{ color: "var(--text-pri)" }}>אין תורים פנויים בקרוב</p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>נסה לבחור תאריך מאוחר יותר ביומן</p>
            </div>
          </div>
        )}

        {/* ── Pick a specific date instead ── */}
        {!loading && (
          <Link
            href={publicHref(slug, `/book/time?staffId=${staffId}&serviceId=${serviceId}`)}
            className="mt-8 flex items-center justify-center gap-2 rounded-2xl py-4 active:scale-[0.98] transition-transform"
            style={{ background: "var(--bg-alt)", border: "1.5px solid var(--divider)" }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              style={{ color: "var(--text-sec)" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-[13px] font-bold" style={{ color: "var(--text-pri)" }}>בחר תאריך ספציפי</span>
          </Link>
        )}
      </div>
    </div>
  );
}

export default function UpcomingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
          <div className="text-[10px] tracking-[0.3em] uppercase" style={{ color: "var(--text-muted)" }}>טוען...</div>
        </div>
      }
    >
      <UpcomingPageContent />
    </Suspense>
  );
}
