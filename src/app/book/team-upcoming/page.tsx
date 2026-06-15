"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useSlug, apiWithSlug, publicHref } from "@/lib/public-nav";

type TeamSlot = {
  staffId: string;
  staffName: string;
  staffAvatar: string | null;
  serviceId: string;
  serviceName: string;
  date: string;
  time: string;
  duration: number;
  price: number;
};

function getDayName(date: Date): string {
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  return days[date.getDay()];
}
// Friendly Hebrew label: היום / מחר (שני) / שני · 7.7
function smartDateLabel(dateStr: string, today: Date): string {
  const d = new Date(dateStr + "T00:00:00");
  const diff = Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  const name = getDayName(d);
  if (diff === 0) return "היום";
  if (diff === 1) return `מחר (${name})`;
  return `${name} · ${d.getDate()}.${d.getMonth() + 1}`;
}

function BackArrow({ href }: { href: string }) {
  return (
    <Link href={href}
      className="w-9 h-9 flex items-center justify-center rounded-full transition-colors"
      style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)" }}>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        style={{ color: "var(--text-sec)" }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

function TeamUpcomingContent() {
  const slug = useSlug();
  const [today] = useState(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; });
  const [slots, setSlots] = useState<TeamSlot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(apiWithSlug("/api/slots/upcoming-team", slug))
      .then(r => r.ok ? r.json() : { slots: [] })
      .then((data: { slots?: TeamSlot[] }) => {
        setSlots(data.slots || []);
        setLoading(false);
      })
      .catch(() => { setSlots([]); setLoading(false); });
  }, [slug]);

  // Keep the merged order from the API, but group consecutive same-day slots
  // under one date header for a clean, scannable list.
  const grouped = useMemo(() => {
    const out: { date: string; items: TeamSlot[] }[] = [];
    for (const s of slots) {
      const last = out[out.length - 1];
      if (last && last.date === s.date) last.items.push(s);
      else out.push({ date: s.date, items: [s] });
    }
    return out;
  }, [slots]);

  return (
    <div className="min-h-screen pb-24" dir="rtl" style={{ background: "var(--bg)" }}>
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-20 px-4 py-3"
        style={{ background: "var(--header-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--divider)" }}>
        <div className="flex items-center justify-between">
          <BackArrow href={publicHref(slug, "/book")} />
          <h1 className="text-[13px] font-semibold tracking-[0.12em]" style={{ color: "var(--text-pri)" }}>
            כל התורים הקרובים
          </h1>
          <div className="w-9" />
        </div>
      </div>

      <div className="px-4 pt-5">
        {loading ? (
          <div className="flex flex-col gap-2.5">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
            ))}
          </div>
        ) : grouped.length > 0 ? (
          <div className="flex flex-col gap-6">
            {grouped.map((g, gi) => (
              <div key={`${g.date}-${gi}`}>
                <p className="text-[11px] tracking-[0.2em] uppercase font-bold mb-2.5" style={{ color: "var(--brand)" }}>
                  {smartDateLabel(g.date, today)}
                </p>
                <div className="flex flex-col gap-2">
                  {g.items.map((s, i) => (
                    <Link key={`${s.staffId}-${s.time}-${i}`}
                      href={publicHref(slug, `/book/confirm?staffId=${s.staffId}&serviceId=${s.serviceId}&date=${s.date}&time=${s.time}`)}
                      className="flex items-center gap-3 rounded-2xl px-3.5 py-3 transition-all active:scale-[0.98]"
                      style={{ background: "var(--card)", border: "1px solid var(--divider)" }}>
                      {/* Barber avatar */}
                      <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0"
                        style={{ border: "1px solid var(--divider)" }}>
                        {s.staffAvatar ? (
                          <img src={s.staffAvatar} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-sm font-bold text-white"
                            style={{ background: "var(--brand)" }}>
                            {s.staffName[0]}
                          </div>
                        )}
                      </div>
                      {/* Barber + service */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: "var(--text-pri)" }}>{s.staffName}</p>
                        <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{s.serviceName}</p>
                      </div>
                      {/* Time */}
                      <span className="text-[17px] font-bold tracking-widest flex-shrink-0" dir="ltr"
                        style={{ color: "var(--brand)" }}>{s.time}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-20 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl"
              style={{ background: "var(--card)", border: "1px solid var(--divider)" }}>📅</div>
            <div className="text-center">
              <p className="text-sm font-semibold" style={{ color: "var(--text-pri)" }}>אין תורים פנויים בקרוב</p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>נסה לבחור ספר ותאריך ביומן</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TeamUpcomingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
          <div className="text-[10px] tracking-[0.3em] uppercase" style={{ color: "var(--text-muted)" }}>טוען...</div>
        </div>
      }
    >
      <TeamUpcomingContent />
    </Suspense>
  );
}
