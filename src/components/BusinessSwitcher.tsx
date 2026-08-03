"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Result = { slug: string; name: string; logoUrl: string | null; matchedStaffName: string | null };

// "Switch business" search trigger + overlay. Used in two places, sharing
// the same search/modal logic: FooterCTA (variant="text", bottom of every
// page) and the hero icon row on the home page (variant="icon", small glass
// button matching the existing waze/phone/instagram icons there). Searches
// by shop name OR any staff member's name — lets a customer who only
// remembers "the barber's name" find the right shop.
export default function BusinessSwitcher({
  currentSlug,
  variant = "text",
}: {
  currentSlug: string | null;
  variant?: "text" | "icon";
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q });
      if (currentSlug) params.set("exclude", currentSlug);
      fetch(`/api/businesses/search?${params}`)
        .then(r => r.json())
        .then(d => setResults(Array.isArray(d) ? d : []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, open, currentSlug]);

  return (
    <>
      {variant === "icon" ? (
        <button
          onClick={() => setOpen(true)}
          aria-label="חיפוש מספרה אחרת"
          className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90 transition-transform"
          style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.18)" }}
        >
          <svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="text-[12px] text-neutral-400 underline underline-offset-2 hover:text-neutral-600 transition"
        >
          🔍 חיפוש מספרה אחרת
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[100] bg-black/50 flex items-start sm:items-center justify-center p-4 pt-20 sm:pt-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[70vh] flex flex-col overflow-hidden"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 p-4 border-b border-neutral-100">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="שם ספר או שם מספרה..."
                className="flex-1 text-sm outline-none placeholder:text-neutral-400"
              />
              <button
                onClick={() => setOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 text-xl leading-none px-1"
                aria-label="סגור"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {loading ? (
                <p className="text-center text-sm text-neutral-400 py-8">מחפש...</p>
              ) : q.trim().length < 2 ? (
                <p className="text-center text-sm text-neutral-400 py-8">הקלידו לפחות 2 תווים</p>
              ) : results.length === 0 ? (
                <p className="text-center text-sm text-neutral-400 py-8">לא נמצאו תוצאות</p>
              ) : (
                results.map((r) => (
                  <Link
                    key={r.slug}
                    href={`/${r.slug}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 transition border-b border-neutral-50 last:border-0"
                  >
                    <div className="w-9 h-9 rounded-full overflow-hidden bg-neutral-100 flex-shrink-0 border border-neutral-200">
                      {r.logoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.logoUrl} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-neutral-800 truncate">{r.name}</p>
                      {r.matchedStaffName && (
                        <p className="text-[12px] text-neutral-400 truncate">👤 {r.matchedStaffName} עובד/ת שם</p>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
