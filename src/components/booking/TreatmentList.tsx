"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSlug, apiWithSlug, publicHref } from "@/lib/public-nav";
import { useStaffChoice } from "@/components/VocabProvider";

/**
 * Treatment first (16.10.2026, Yair: "שמסך השירותים יהיה לפני מסך נותני
 * השירות כי לא כל נותן שירות מבצע כל שירות"). Every treatment someone in the
 * business does; when people charge differently it says "החל מ". Tapping one
 * goes to who does it (/book/pro), which skips itself when only one does.
 */
type Treatment = {
  id: string; name: string; description: string | null; note: string | null; showDuration: boolean;
  priceMin: number; priceMax: number; durationMin: number; durationMax: number;
  category: string | null; priceFrom: boolean;
};

export function priceLabel(min: number, max: number, from = false): string {
  return from || min < max ? `החל מ־₪${min}` : `₪${min}`;
}

export default function TreatmentList() {
  const slug = useSlug();
  // The system assigns who (settings): straight from the treatment to the times.
  const auto = useStaffChoice() !== "customer";
  const [items, setItems] = useState<Treatment[] | null>(null);
  useEffect(() => {
    fetch(apiWithSlug("/api/services?offered=1", slug)).then(r => (r.ok ? r.json() : [])).then(d => setItems(Array.isArray(d) ? d : [])).catch(() => setItems([]));
  }, [slug]);

  if (items === null) {
    return <div className="space-y-2.5">{[1, 2, 3].map(i => <div key={i} className="h-[76px] rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />)}</div>;
  }
  if (!items.length) return <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>אין כרגע טיפולים פתוחים לקביעה.</p>;

  // Grouped by category, in the order the categories first appear (the catalog's order).
  const groups: { name: string | null; items: Treatment[] }[] = [];
  for (const t of items) {
    const g = groups.find(x => x.name === (t.category ?? null));
    if (g) g.items.push(t); else groups.push({ name: t.category ?? null, items: [t] });
  }
  const named = groups.some(g => g.name);

  return (
    <div className="space-y-5">
      {groups.map(g => (
        <div key={g.name ?? "_"} className="space-y-2.5">
          {named && <h3 className="text-[12px] font-semibold tracking-[0.15em]" style={{ color: "var(--brand)" }}>{g.name ?? "עוד"}</h3>}
      {g.items.map(t => (
        <Link key={t.id} href={publicHref(slug, auto ? `/book/team-date?serviceId=${t.id}` : `/book/pro?serviceId=${t.id}`)}
          className="flex items-center rounded-2xl overflow-hidden active:scale-[0.99] transition-all"
          style={{ background: "var(--card)", border: "1px solid var(--divider)", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
          <div className="w-1 self-stretch flex-shrink-0" style={{ background: "var(--brand)" }} />
          <div className="flex items-center flex-1 gap-3 px-4 py-4 min-w-0">
            <div className="flex-1 min-w-0">
              <h3 className="text-[14px] font-semibold leading-tight" style={{ color: "var(--text-pri)" }}>{t.name}</h3>
              {t.description && <p className="text-[11px] mt-1 leading-relaxed line-clamp-2" style={{ color: "var(--text-muted)" }}>{t.description}</p>}
              {t.showDuration !== false && (
                <span className="inline-block text-[11px] px-2 py-0.5 rounded-full mt-1.5" style={{ background: "var(--bg-alt)", color: "var(--text-muted)" }}>
                  {t.durationMin < t.durationMax ? `${t.durationMin}–${t.durationMax}` : t.durationMin} דקות
                </span>
              )}
            </div>
            <div className="flex-shrink-0 flex items-center gap-2">
              <p className={`${t.priceFrom || t.priceMin < t.priceMax ? "text-[15px]" : "text-[22px]"} font-bold leading-none`} style={{ color: "var(--brand)" }}>{priceLabel(t.priceMin, t.priceMax, t.priceFrom)}</p>
              <svg className="w-4 h-4 rotate-180 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "var(--text-muted)" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </Link>
      ))}
        </div>
      ))}
    </div>
  );
}
