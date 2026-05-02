"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import FooterCTA from "@/components/FooterCTA";
import { THEMES, type Theme } from "@/lib/themes";

// ── Types ──────────────────────────────────────────────────────────────────────
type Story = { id: string; mediaUrl: string; caption: string | null };
type QuickSlot = {
  staffId: string; staffName: string; staffAvatar: string | null;
  date: string; dayLabel: string; time: string;
  serviceId: string; serviceName: string; price: number; duration: number;
};
type Staff = {
  id: string; name: string; avatarUrl: string | null;
  portfolio: { id: string; imageUrl: string; caption: string | null }[];
};
type Announcement = { id: string; title: string; content: string | null; isPinned: boolean };
type Product = { id: string; name: string; description: string | null; price: number; imageUrl: string | null };
type BusinessInfo = {
  name: string; logoUrl: string | null; coverImageUrl: string | null; heroVideoUrl: string | null;
  brandColor: string | null; bgColor: string | null;
  phone: string | null; address: string | null; about: string | null;
  theme: Theme; // full palette object from API
  socialLinks: { whatsapp?: string; instagram?: string; facebook?: string; tiktok?: string; waze?: string };
};
type PortfolioWork = { imageUrl: string; staffName: string; staffAvatar: string | null };

// ── Stories viewer ─────────────────────────────────────────────────────────────
function StoriesCarousel({ stories }: { stories: Story[] }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [progress, setProgress] = useState(0);

  function openStory(idx: number) { setActiveIdx(idx); setProgress(0); }
  function closeStory() { setActiveIdx(null); if (timerRef.current) clearInterval(timerRef.current); }
  function goNext() { if (activeIdx === null) return; openStory((activeIdx + 1) % stories.length); }
  function goPrev() { if (activeIdx === null) return; openStory((activeIdx - 1 + stories.length) % stories.length); }

  useEffect(() => {
    if (activeIdx === null) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(0);
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const pct = Math.min(((Date.now() - start) / 5000) * 100, 100);
      setProgress(pct);
      if (Date.now() - start >= 5000) { clearInterval(timerRef.current!); goNext(); }
    }, 50);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx]);

  if (stories.length === 0) return null;
  const activeStory = activeIdx !== null ? stories[activeIdx] : null;

  return (
    <>
      <div className="flex gap-4 px-5 py-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {stories.map((story, idx) => (
          <button key={story.id} onClick={() => openStory(idx)} className="flex flex-col items-center gap-1.5 flex-shrink-0">
            <div className="w-[58px] h-[58px] rounded-full p-[2px]"
              style={{ background: `linear-gradient(135deg, var(--brand), rgba(201,168,76,0.4))` }}>
              <div className="w-full h-full rounded-full overflow-hidden" style={{ border: "2px solid var(--bg)" }}>
                <img src={story.mediaUrl} alt="" className="w-full h-full object-cover" />
              </div>
            </div>
            {story.caption && (
              <span className="text-[10px] w-14 truncate text-center" style={{ color: "var(--text-muted)" }}>
                {story.caption}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeStory && (
        <div className="fixed inset-0 bg-black z-[60] flex flex-col" onClick={closeStory}>
          <div className="flex gap-1 p-3 pt-4">
            {stories.map((_, i) => (
              <div key={i} className="h-[2px] flex-1 rounded-full" style={{ background: "rgba(255,255,255,0.25)" }}>
                <div className="h-full rounded-full bg-white"
                  style={{ width: i < activeIdx! ? "100%" : i === activeIdx ? `${progress}%` : "0%", transition: "none" }} />
              </div>
            ))}
          </div>
          <div className="flex-1 flex items-center justify-center px-3">
            <img src={activeStory.mediaUrl} alt="" className="max-h-[80vh] w-full object-contain rounded-2xl" />
          </div>
          {activeStory.caption && (
            <div className="absolute bottom-20 inset-x-0 text-center px-6">
              <p className="text-white text-sm">{activeStory.caption}</p>
            </div>
          )}
          <button onClick={e => { e.stopPropagation(); goPrev(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.15)" }}>
            <span className="text-white text-xl">›</span>
          </button>
          <button onClick={e => { e.stopPropagation(); goNext(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.15)" }}>
            <span className="text-white text-xl">‹</span>
          </button>
        </div>
      )}
    </>
  );
}

// ── Quick Slots ────────────────────────────────────────────────────────────────
function QuickSlotsCarousel({ slots }: { slots: QuickSlot[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const autoScrollRef = useRef<NodeJS.Timeout | null>(null);

  const startAutoScroll = useCallback(() => {
    if (autoScrollRef.current) clearInterval(autoScrollRef.current);
    autoScrollRef.current = setInterval(() => setActiveIndex(p => (p + 1) % slots.length), 3000);
  }, [slots.length]);

  useEffect(() => {
    if (!slots.length) return;
    startAutoScroll();
    return () => { if (autoScrollRef.current) clearInterval(autoScrollRef.current); };
  }, [slots.length, startAutoScroll]);

  useEffect(() => {
    if (!scrollRef.current || !slots.length) return;
    scrollRef.current.scrollTo({ left: activeIndex * 120, behavior: "smooth" });
  }, [activeIndex, slots.length]);

  if (!slots.length) return null;
  const displaySlots = [...slots, ...slots, ...slots];

  return (
    <div>
      <div ref={scrollRef} className="flex gap-2.5 overflow-x-auto pb-1"
        style={{ scrollbarWidth: "none" }}
        onTouchStart={() => autoScrollRef.current && clearInterval(autoScrollRef.current)}
        onTouchEnd={startAutoScroll}>
        {displaySlots.map((slot, i) => (
          <Link key={i}
            href={`/book/confirm?staffId=${slot.staffId}&serviceId=${slot.serviceId}&date=${slot.date}&time=${slot.time}`}
            className="flex-shrink-0 min-w-[112px] rounded-2xl p-3.5 active:scale-95 transition-transform"
            style={{ background: "var(--card)", border: "1px solid var(--divider)" }}>
            <p className="text-base font-semibold tracking-widest leading-none mb-1.5" dir="ltr"
              style={{ color: "var(--brand)" }}>{slot.time}</p>
            <p className="text-[11px] leading-none mb-0.5" style={{ color: "var(--text-sec)" }}>{slot.dayLabel}</p>
            <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{slot.staffName}</p>
          </Link>
        ))}
      </div>
      <div className="flex justify-center gap-1.5 mt-3">
        {slots.map((_, i) => (
          <div key={i} onClick={() => setActiveIndex(i)} className="rounded-full transition-all duration-300 cursor-pointer"
            style={{
              width: i === activeIndex % slots.length ? 16 : 6,
              height: 6,
              background: i === activeIndex % slots.length ? "var(--brand)" : "var(--divider)",
            }} />
        ))}
      </div>
    </div>
  );
}

// ── Section Label ──────────────────────────────────────────────────────────────
function SecLabel({ en, he }: { en: string; he: string }) {
  return (
    <div className="px-5 mb-6">
      <p className="text-[10px] tracking-[0.35em] uppercase mb-1.5 font-medium" style={{ color: "var(--brand)" }}>{en}</p>
      <h2 className="font-light leading-none" style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.4rem,5vw,1.8rem)", color: "var(--text-pri)" }}>
        {he}
      </h2>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function HomePage() {
  const [quickSlots, setQuickSlots] = useState<QuickSlot[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 0.75);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/quick-slots").then(r => r.json()),
      fetch("/api/staff").then(r => r.json()),
      fetch("/api/announcements").then(r => r.json()),
      fetch("/api/products").then(r => r.json()),
      fetch("/api/business").then(r => r.json()),
      fetch("/api/stories").then(r => r.json()).catch(() => []),
    ]).then(([slots, staffData, ann, prod, biz, storiesData]) => {
      setQuickSlots(slots);
      setStaff(staffData);
      setAnnouncements(ann);
      setProducts(prod);
      setBusiness(biz);
      setStories(Array.isArray(storiesData) ? storiesData : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Full theme palette comes from /api/business — fallback to default if API hasn't responded yet
  const T: Theme = business?.theme || THEMES.onyx;
  const brandColor = T.brand;
  const isDark = T.isDark;

  // Social links
  const rawSocial = business?.socialLinks || {};
  function toUrl(key: string, val: string): string {
    if (!val) return "";
    if (val.startsWith("http")) return val;
    if (key === "whatsapp") return `https://wa.me/${val.replace(/\D/g, "")}`;
    if (key === "instagram") return `https://instagram.com/${val.replace("@", "")}`;
    if (key === "facebook") return `https://facebook.com/${val.replace("@", "")}`;
    return val;
  }
  const social = {
    whatsapp:  toUrl("whatsapp",  rawSocial.whatsapp  || ""),
    instagram: toUrl("instagram", rawSocial.instagram || ""),
    facebook:  toUrl("facebook",  rawSocial.facebook  || ""),
    waze:      rawSocial.waze || "",
  };

  const portfolioWorks: PortfolioWork[] = staff
    .filter(s => s.portfolio.length > 0)
    .flatMap(s => s.portfolio.map(p => ({ imageUrl: p.imageUrl, staffName: s.name, staffAvatar: s.avatarUrl })));

  const cssVars = `
    :root {
      --brand:        ${T.brand};
      --brand-soft:   ${T.brandSoft};
      --bg:           ${T.bg};
      --bg-alt:       ${T.bgAlt};
      --card:         ${T.card};
      --text-pri:     ${T.textPri};
      --text-sec:     ${T.textSec};
      --text-muted:   ${T.textMuted};
      --divider:      ${T.divider};
      --header-bg:    ${T.headerBg};
      --font-display: ${T.fontDisplay};
      --font-body:    ${T.fontBody};
    }
    body { font-family: var(--font-body); }
  `;

  return (
    <div className="min-h-screen flex flex-col" dir="rtl"
      style={{ background: "var(--bg)", color: "var(--text-pri)" }}>
      <style>{cssVars}</style>

      {/* ══════════════════════════════════════════════════════
          STICKY HEADER
      ══════════════════════════════════════════════════════ */}
      <header className="fixed top-0 inset-x-0 z-50 transition-all duration-500"
        style={{
          transform: scrolled ? "translateY(0)" : "translateY(-110%)",
          opacity: scrolled ? 1 : 0,
          pointerEvents: scrolled ? "auto" : "none",
          background: T.headerBg,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: `1px solid ${T.divider}`,
        }}>
        <div className="flex items-center gap-3 px-4 py-3">
          {business?.logoUrl && (
            <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0"
              style={{ border: `1px solid ${T.divider}` }}>
              <img src={business.logoUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="uppercase leading-none tracking-[0.12em]"
              style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.05rem", color: "var(--text-pri)" }}>
              {business?.name || "DOMINANT"}
            </p>
          </div>
          <Link href="/book"
            className="flex-shrink-0 text-[11px] font-bold tracking-[0.15em] uppercase px-5 py-2.5 rounded-full text-white"
            style={{ background: brandColor }}>
            קבע תור
          </Link>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════
          HERO — full viewport
      ══════════════════════════════════════════════════════ */}
      <section className="relative flex flex-col" style={{ minHeight: "100svh" }}>

        {/* BG: video > image > gradient */}
        {business?.heroVideoUrl ? (
          <video
            src={business.heroVideoUrl}
            autoPlay muted loop playsInline
            className="absolute inset-0 w-full h-full object-cover"
            style={{ objectPosition: "center 20%" }}
          />
        ) : business?.coverImageUrl ? (
          <img src={business.coverImageUrl} alt=""
            className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: "center 20%" }} />
        ) : (
          <div className="absolute inset-0" style={{ background: "linear-gradient(160deg,#0A0A0A 0%,#1A1510 100%)" }} />
        )}

        {/* Multi-stop overlay */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.1) 30%, rgba(0,0,0,0.55) 65%, rgba(0,0,0,0.95) 100%)" }} />

        {/* ── Social icons ── */}
        <div className="relative z-10 flex justify-between items-start px-5 pt-14">
          <div className="flex gap-2">
            {social.waze && (
              <a href={social.waze} target="_blank" rel="noopener noreferrer"
                className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.15)" }}>
                <svg viewBox="0 0 24 24" className="w-4.5 h-4.5 w-[18px] h-[18px]"><path fill="#33CCFF" d="M12 2C6.486 2 2 6.486 2 12c0 1.527.35 2.97.97 4.26L2 22l5.74-.97A9.953 9.953 0 0012 22c5.514 0 10-4.486 10-10S17.514 2 12 2zm-2 9a1 1 0 110-2 1 1 0 010 2zm4 0a1 1 0 110-2 1 1 0 010 2zm-5 3s1 2 3 2 3-2 3-2H9z" /></svg>
              </a>
            )}
            {social.facebook && (
              <a href={social.facebook} target="_blank" rel="noopener noreferrer"
                className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.15)" }}>
                <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
              </a>
            )}
            {business?.phone && (
              <a href={`tel:${business.phone}`}
                className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.15)" }}>
                <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
                </svg>
              </a>
            )}
          </div>
          <div className="flex gap-2">
            {social.instagram && (
              <a href={social.instagram} target="_blank" rel="noopener noreferrer"
                className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.15)" }}>
                <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]"><path fill="#E4405F" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" /></svg>
              </a>
            )}
            {social.whatsapp && (
              <a href={social.whatsapp} target="_blank" rel="noopener noreferrer"
                className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.15)" }}>
                <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
              </a>
            )}
          </div>
        </div>

        {/* ── Center content ── */}
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 pb-8">
          {/* Logo ring */}
          {business?.logoUrl && (
            <div className="mb-6 rounded-full overflow-hidden"
              style={{
                width: 72, height: 72,
                border: `1.5px solid rgba(255,255,255,0.25)`,
                boxShadow: `0 0 30px rgba(${parseInt(brandColor.slice(1,3),16)},${parseInt(brandColor.slice(3,5),16)},${parseInt(brandColor.slice(5,7),16)},0.25)`,
              }}>
              <img src={business.logoUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}

          {/* Business name */}
          <h1 className="text-white uppercase mb-1 leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 300,
              fontSize: "clamp(2.4rem, 11vw, 5rem)",
              letterSpacing: "0.14em",
              textShadow: `0 0 60px rgba(${parseInt(brandColor.slice(1,3)||"C9",16)},${parseInt(brandColor.slice(3,5)||"A8",16)},${parseInt(brandColor.slice(5,7)||"4C",16)}, 0.3), 0 2px 20px rgba(0,0,0,0.8)`,
            }}>
            {business?.name || "DOMINANT"}
          </h1>
          <p className="text-white/40 tracking-[0.5em] text-[11px] mb-10"
            style={{ fontFamily: "var(--font-display)", fontWeight: 300 }}>
            barbershop
          </p>

          {/* CTA */}
          <Link href="/book"
            className="inline-flex items-center gap-3 font-semibold text-[13px] tracking-[0.18em] uppercase px-8 py-4 rounded-full text-black active:scale-95 transition-transform"
            style={{ background: brandColor, boxShadow: `0 8px 32px rgba(${parseInt(brandColor.slice(1,3)||"C9",16)},${parseInt(brandColor.slice(3,5)||"A8",16)},${parseInt(brandColor.slice(5,7)||"4C",16)},0.45)` }}>
            זמן תור עכשיו ←
          </Link>
        </div>

        {/* Bottom fade into next section */}
        <div className="absolute bottom-0 inset-x-0 h-24 pointer-events-none"
          style={{ background: `linear-gradient(to top, ${T.bg}, transparent)` }} />

        {/* Scroll hint */}
        <div className="relative z-10 flex justify-center pb-6">
          <div className="flex flex-col items-center gap-1 opacity-40">
            <div className="w-px h-6" style={{ background: "white" }} />
            <div className="w-1.5 h-1.5 rounded-full bg-white" />
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          PORTFOLIO — immediately after hero
      ══════════════════════════════════════════════════════ */}
      {!loading && portfolioWorks.length > 0 && (
        <section style={{ background: "var(--bg-alt)" }} className="py-10 overflow-hidden">
          <div className="flex items-end justify-between px-5 mb-5">
            <div>
              <p className="text-[10px] tracking-[0.35em] uppercase font-medium mb-1.5" style={{ color: "var(--brand)" }}>Portfolio</p>
              <h2 className="font-light leading-none" style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.4rem,5vw,1.8rem)", color: "var(--text-pri)" }}>
                מהעבודות שלנו
              </h2>
            </div>
            <Link href="/book" className="text-[11px] tracking-[0.15em] font-medium" style={{ color: "var(--brand)" }}>
              בחר סגנון →
            </Link>
          </div>

          <div className="flex gap-3 overflow-x-auto px-5 pb-2 snap-x snap-mandatory" style={{ scrollbarWidth: "none" }}>
            {portfolioWorks.map((work, i) => (
              <Link key={i} href="/book" className="flex-shrink-0 snap-start active:scale-[0.97] transition-transform"
                style={{ width: 170 }}>
                <div className="rounded-2xl overflow-hidden relative" style={{ aspectRatio: "3/4" }}>
                  <img src={work.imageUrl} alt={work.staffName}
                    className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <div className="absolute inset-0"
                    style={{ background: "linear-gradient(180deg, transparent 45%, rgba(0,0,0,0.75) 100%)" }} />
                  <div className="absolute bottom-3 right-3 left-3 flex items-center gap-2">
                    {work.staffAvatar ? (
                      <img src={work.staffAvatar} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                        style={{ border: "1.5px solid rgba(255,255,255,0.5)" }} />
                    ) : (
                      <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] text-white font-bold"
                        style={{ background: brandColor }}>{work.staffName[0]}</div>
                    )}
                    <span className="text-[11px] text-white/90 font-medium truncate">{work.staffName}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════
          STAFF — choose your barber
      ══════════════════════════════════════════════════════ */}
      {staff.length > 0 && (
        <section style={{ background: "var(--bg)" }} className="py-10">
          <SecLabel en="The Team" he="הספרים שלנו" />
          <div className="flex gap-4 overflow-x-auto px-5 pb-2" style={{ scrollbarWidth: "none" }}>
            {staff.map(member => (
              <Link key={member.id} href={`/book/service?staffId=${member.id}`}
                className="flex-shrink-0 active:scale-[0.97] transition-transform" style={{ width: 130 }}>
                {/* Portrait photo */}
                <div className="rounded-2xl overflow-hidden relative mb-3"
                  style={{ aspectRatio: "3/4", border: `1px solid ${T.divider}`, boxShadow: isDark ? "0 8px 30px rgba(0,0,0,0.5)" : "0 4px 20px rgba(0,0,0,0.08)" }}>
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl font-light"
                      style={{ background: "var(--bg-alt)", color: "var(--text-muted)" }}>
                      {member.name[0]}
                    </div>
                  )}
                  {/* Bottom overlay */}
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 50%)" }} />
                  <div className="absolute bottom-2.5 inset-x-0 text-center">
                    <span className="text-[10px] font-semibold tracking-[0.2em] uppercase"
                      style={{ color: brandColor }}>בחר →</span>
                  </div>
                </div>
                <p className="text-center text-[12px] font-medium tracking-[0.08em]"
                  style={{ color: "var(--text-pri)" }}>{member.name}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════
          QUICK SLOTS — available now
      ══════════════════════════════════════════════════════ */}
      {!loading && quickSlots.length > 0 && (
        <section id="quick-slots" style={{ background: "var(--bg-alt)" }} className="px-5 py-10">
          <div className="flex items-center gap-3 mb-6">
            <div>
              <p className="text-[10px] tracking-[0.35em] uppercase font-medium mb-1.5" style={{ color: "var(--brand)" }}>Available Now</p>
              <h2 className="font-light leading-none flex items-center gap-2.5"
                style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.4rem,5vw,1.8rem)", color: "var(--text-pri)" }}>
                תורים פנויים
                <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: "#4ADE80" }} />
              </h2>
            </div>
          </div>
          <QuickSlotsCarousel slots={quickSlots} />
        </section>
      )}

      {/* ══════════════════════════════════════════════════════
          STORIES
      ══════════════════════════════════════════════════════ */}
      {!loading && stories.length > 0 && (
        <section style={{ background: "var(--bg)" }} className="pt-6 pb-4">
          <p className="text-[10px] tracking-[0.35em] uppercase font-medium px-5 mb-3" style={{ color: "var(--brand)" }}>Stories</p>
          <StoriesCarousel stories={stories} />
        </section>
      )}

      {/* ══════════════════════════════════════════════════════
          ANNOUNCEMENTS
      ══════════════════════════════════════════════════════ */}
      {announcements.length > 0 && (
        <section style={{ background: "var(--bg-alt)" }} className="py-10 px-5">
          <SecLabel en="Updates" he="עדכונים" />
          <div className="space-y-3">
            {announcements.map(ann => (
              <div key={ann.id} className="rounded-2xl p-4 relative overflow-hidden"
                style={{ background: "var(--card)", border: `1px solid ${T.divider}`, boxShadow: isDark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 2px 12px rgba(0,0,0,0.05)" }}>
                {ann.isPinned && (
                  <div className="absolute top-0 right-0 bottom-0 w-[3px] rounded-r-2xl" style={{ background: brandColor }} />
                )}
                <p className="text-[13px] font-semibold mb-1.5 pr-3 leading-snug" style={{ color: "var(--text-pri)" }}>
                  {ann.title}
                </p>
                {ann.content && (
                  <p className="text-[12px] leading-relaxed pr-3" style={{ color: "var(--text-sec)" }}>
                    {ann.content}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════
          PRODUCTS — shop
      ══════════════════════════════════════════════════════ */}
      {products.length > 0 && (
        <section style={{ background: "var(--bg)" }} className="py-10">
          <SecLabel en="Shop" he="מוצרים" />
          <div className="flex gap-3 overflow-x-auto px-5 pb-2" style={{ scrollbarWidth: "none" }}>
            {products.map(product => (
              <div key={product.id} className="flex-shrink-0 rounded-2xl overflow-hidden active:scale-[0.97] transition-transform"
                style={{ width: 155, background: "var(--card)", border: `1px solid ${T.divider}`, boxShadow: isDark ? "0 6px 24px rgba(0,0,0,0.4)" : "0 4px 16px rgba(0,0,0,0.07)" }}>
                <div className="h-36 flex items-center justify-center overflow-hidden"
                  style={{ background: "var(--bg-alt)" }}>
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl opacity-30">🧴</span>
                  )}
                </div>
                <div className="p-3.5">
                  <p className="text-[13px] font-medium mb-1 leading-tight" style={{ color: "var(--text-pri)" }}>{product.name}</p>
                  {product.description && (
                    <p className="text-[11px] line-clamp-2 leading-relaxed mb-2" style={{ color: "var(--text-muted)" }}>{product.description}</p>
                  )}
                  <p className="text-[15px] font-bold" style={{ color: brandColor }}>₪{product.price}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════
          ABOUT
      ══════════════════════════════════════════════════════ */}
      {business?.about && (
        <section style={{ background: "var(--bg-alt)" }} className="py-10 px-5">
          <SecLabel en="About" he="אודות" />
          <p className="text-[14px] leading-loose" style={{ color: "var(--text-sec)" }}>{business.about}</p>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════════════════ */}
      <FooterCTA />
      <div className="py-8 text-center" style={{ background: "var(--bg)", borderTop: `1px solid ${T.divider}` }}>
        <p className="text-[10px] tracking-[0.3em] uppercase" style={{ color: "var(--text-muted)" }}>
          {business?.name || "DOMINANT"} &copy; {new Date().getFullYear()}
        </p>
      </div>

      {/* ══ Pulse banner — shown when there are quick slots ══ */}
      {!loading && quickSlots.length > 0 && (
        <div className="fixed bottom-6 left-4 z-40 pointer-events-auto">
          <a href="#quick-slots"
            className="relative flex items-center gap-2.5 px-5 py-3 rounded-full text-white text-[13px] font-bold shadow-2xl active:scale-95 transition-transform"
            style={{
              background: brandColor,
              boxShadow: `0 4px 24px rgba(${parseInt(brandColor.slice(1,3)||"C9",16)},${parseInt(brandColor.slice(3,5)||"A8",16)},${parseInt(brandColor.slice(5,7)||"4C",16)},0.5)`,
              animation: "quick-pulse 2.5s ease-in-out infinite",
            }}>
            {/* Ping dot */}
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
            </span>
            ⚡ יש תורים פנויים עכשיו
          </a>
        </div>
      )}
    </div>
  );
}
