"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSlug, apiWithSlug, publicHref } from "@/lib/public-nav";
import { useG } from "@/components/VocabProvider";
import { worksKey, WANT_PHOTO } from "@/lib/works-shared";

type Work = { id: string; mediaUrl: string; caption: string | null; serviceId: string | null; staff: { id: string; name: string; avatarUrl: string | null } | null };
type Service = { id: string; name: string };
type Biz = { name: string; logoUrl: string | null; socialLinks?: { whatsapp?: string } | null };

/** WhatsApp's wa.me wants 972… digits; the shop may store +972… or 05…. */
const waDigits = (raw?: string) => (raw ?? "").replace(/\D/g, "").replace(/^0/, "972");

/**
 * The works page (skeleton approved 4.11.2026): a tab per treatment that has
 * works, opened on the one in ?s= (the agent's link), a photo full screen with
 * "כזה אני רוצה", and one booking button.
 */
export default function WorksGallery() {
  const slug = useSlug();
  const g = useG();
  const params = useSearchParams();
  const [works, setWorks] = useState<Work[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [biz, setBiz] = useState<Biz | null>(null);
  const [tab, setTab] = useState<string>("all");
  const [open, setOpen] = useState<number | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(apiWithSlug("/api/stories", slug)).then(r => r.json()).catch(() => []),
      fetch(apiWithSlug("/api/services", slug)).then(r => r.json()).catch(() => []),
      fetch(apiWithSlug("/api/business", slug)).then(r => r.json()).catch(() => null),
    ]).then(([w, s, b]) => {
      const list: Work[] = Array.isArray(w) ? w : [];
      const svcs: Service[] = Array.isArray(s) ? s : [];
      setWorks(list);
      setServices(svcs);
      setBiz(b);
      const key = params.get("s");
      const hit = key ? svcs.find(x => x.id.startsWith(key) && list.some(it => it.serviceId === x.id)) : null;
      if (hit) setTab(hit.id);
    });
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // The tab the link opened on is in view, even far along the row.
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>("[aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [tab, works]);

  const tabs = services.filter(s => works?.some(w => w.serviceId === s.id));
  const shown = (works ?? []).filter(w => tab === "all" || w.serviceId === tab);
  const service = services.find(s => s.id === tab) ?? null;
  const serviceName = (w: Work) => services.find(s => s.id === w.serviceId)?.name ?? null;

  function pick(id: string) {
    setTab(id);
    const url = new URL(window.location.href);
    if (id === "all") url.searchParams.delete("s"); else url.searchParams.set("s", worksKey(id));
    window.history.replaceState(null, "", url);
  }

  const step = (d: number) => setOpen(i => (i === null || !shown.length ? i : (i + d + shown.length) % shown.length));
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowLeft") step(1);
      if (e.key === "ArrowRight") step(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, shown.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const wa = waDigits(biz?.socialLinks?.whatsapp);
  const bookHref = service ? publicHref(slug, `/book/pro?serviceId=${service.id}`) : publicHref(slug, "/book");
  const bookLabel = service ? `${g("קבע", "קבעי")} תור ל${service.name}` : g("קבע תור", "קבעי תור");
  const current = open !== null ? shown[open] : null;

  return (
    <div className="min-h-screen pb-28" dir="rtl" style={{ background: "var(--bg)" }}>
      <header className="book-header sticky top-0 z-20" style={{ background: "var(--header-bg)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderBottom: "1px solid var(--divider)" }}>
        <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 h-14">
          {biz?.logoUrl && <img src={biz.logoUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" style={{ border: "1px solid var(--divider)" }} />}
          <p className="flex-1 min-w-0 truncate font-bold text-[15px]" style={{ color: "var(--text-pri)" }}>{biz?.name ?? ""}</p>
          <Link href={publicHref(slug, "/")} className="shrink-0 h-11 px-1 inline-flex items-center gap-1 text-[14px] font-semibold" style={{ color: "var(--brand)" }}>
            לאתר
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 pt-4">
        <h1 className="text-[26px] font-extrabold leading-tight" style={{ color: "var(--text-pri)" }}>העבודות שלנו</h1>
        <p className="text-[14px] mt-0.5" style={{ color: "var(--text-sec)" }}>
          {works === null ? " " : service ? `${shown.length} עבודות ב${service.name}` : `${shown.length} עבודות`}
        </p>
      </div>
      {tabs.length > 0 && (
        <div className="sticky top-14 z-10" style={{ background: "var(--bg)" }}>
          <div ref={tabsRef} role="tablist" aria-label="טיפולים" className="max-w-5xl mx-auto flex gap-2 overflow-x-auto px-4 py-3" style={{ scrollbarWidth: "none" }}>
            {[{ id: "all", name: "הכל" }, ...tabs].map(t => {
              const on = tab === t.id;
              return (
                <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => pick(t.id)}
                  className="shrink-0 h-11 px-4 rounded-full text-[15px] font-semibold transition-colors"
                  style={on ? { background: "var(--brand)", color: "#fff" } : { background: "var(--card)", color: "var(--text-sec)", border: "1px solid var(--divider)" }}>
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-3 pt-3">
        {works === null ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[4/5] rounded-2xl animate-pulse" style={{ background: "var(--bg-alt)" }} />)}
          </div>
        ) : shown.length === 0 ? (
          <p className="text-center py-20 text-[15px]" style={{ color: "var(--text-sec)" }}>עוד אין כאן עבודות.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {shown.map((w, i) => (
              <button key={w.id} type="button" onClick={() => setOpen(i)} className="relative aspect-[4/5] rounded-2xl overflow-hidden text-right active:scale-[0.98] transition-transform" style={{ background: "var(--bg-alt)" }}
                aria-label={w.caption || serviceName(w) || "עבודה"}>
                <img src={w.mediaUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                {w.staff && (
                  <span className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-full ps-1 pe-2.5 py-1 text-[12px] font-semibold text-white" style={{ background: "rgba(0,0,0,.5)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
                    {w.staff.avatarUrl ? <img src={w.staff.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" /> : <span className="w-1.5" />}
                    {w.staff.name}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </main>

      <div className="fixed bottom-0 inset-x-0 z-10 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]" style={{ background: "linear-gradient(to top, var(--bg) 70%, transparent)" }}>
        <Link href={bookHref} className="max-w-md mx-auto h-14 rounded-2xl flex items-center justify-center text-[17px] font-bold text-white shadow-lg active:scale-[0.98] transition-transform" style={{ background: "var(--brand)" }}>
          {bookLabel}
        </Link>
      </div>

      {current && (
        <div role="dialog" aria-modal="true" aria-label={current.caption || serviceName(current) || "עבודה"} className="fixed inset-0 z-50 flex flex-col" style={{ background: "#0B0B0C" }}
          onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
          onTouchEnd={e => { const s = touchX.current; touchX.current = null; if (s === null) return; const dx = e.changedTouches[0].clientX - s; if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1); }}>
          <div className="flex items-center justify-between px-2 h-14 text-white/80 text-[14px]">
            <button type="button" onClick={() => setOpen(null)} className="w-11 h-11 inline-flex items-center justify-center rounded-full" aria-label="סגירה">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <span className="px-3">{open! + 1} מתוך {shown.length}</span>
          </div>
          <div className="relative flex-1 min-h-0 flex items-center justify-center px-3">
            <img src={current.mediaUrl} alt={current.caption || serviceName(current) || ""} className="max-w-full max-h-full rounded-2xl object-contain" />
            {shown.length > 1 && (
              <>
                <button type="button" onClick={() => step(-1)} className="hidden sm:inline-flex absolute right-4 w-11 h-11 items-center justify-center rounded-full bg-white/10 text-white" aria-label="הקודמת">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
                </button>
                <button type="button" onClick={() => step(1)} className="hidden sm:inline-flex absolute left-4 w-11 h-11 items-center justify-center rounded-full bg-white/10 text-white" aria-label="הבאה">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
              </>
            )}
          </div>
          <div className="max-w-md w-full mx-auto px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] text-white">
            {(current.caption || serviceName(current)) && <p className="text-[18px] font-bold">{current.caption || serviceName(current)}</p>}
            <p className="text-[14px] text-white/65 mt-0.5">{[current.staff?.name, current.caption ? serviceName(current) : null].filter(Boolean).join(" · ")}</p>
            {wa && (
              <a href={`https://wa.me/${wa}?text=${encodeURIComponent(`${WANT_PHOTO} ${current.caption || serviceName(current) || ""}\n${new URL(current.mediaUrl, window.location.origin).href}`)}`}
                target="_blank" rel="noopener noreferrer"
                className="mt-4 h-14 rounded-2xl flex items-center justify-center text-[17px] font-bold active:scale-[0.98] transition-transform" style={{ background: "#fff", color: "#111" }}>
                כזה אני רוצה
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
