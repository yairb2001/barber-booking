"use client";

import { useEffect, useState, useRef } from "react";
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
  theme: Theme;
  socialLinks: { whatsapp?: string; instagram?: string; facebook?: string; tiktok?: string; waze?: string };
};

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
      <div className="flex gap-3 px-5 py-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {stories.map((story, idx) => (
          <button key={story.id} onClick={() => openStory(idx)} className="flex flex-col items-center gap-1.5 flex-shrink-0">
            <div className="w-[54px] h-[54px] rounded-full p-[2.5px]"
              style={{ background: `linear-gradient(135deg, var(--brand), rgba(0,0,0,0.1))` }}>
              <div className="w-full h-full rounded-full overflow-hidden border-2 border-white">
                <img src={story.mediaUrl} alt="" className="w-full h-full object-cover" />
              </div>
            </div>
            {story.caption && (
              <span className="text-[10px] w-14 truncate text-center text-slate-500">{story.caption}</span>
            )}
          </button>
        ))}
      </div>

      {activeStory && (
        <div className="fixed inset-0 bg-black z-[60] flex flex-col" onClick={closeStory}>
          <div className="flex gap-1 p-3 pt-4">
            {stories.map((_, i) => (
              <div key={i} className="h-[2px] flex-1 rounded-full bg-white/25">
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
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 flex items-center justify-center">
            <span className="text-white text-xl">›</span>
          </button>
          <button onClick={e => { e.stopPropagation(); goNext(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 flex items-center justify-center">
            <span className="text-white text-xl">‹</span>
          </button>
        </div>
      )}
    </>
  );
}

// ── Section header — admin-style ────────────────────────────────────────────────
function SecLabel({ label, sub, action }: { label: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="px-5 mb-5 flex items-center justify-between">
      <div>
        {sub && <p className="text-[10px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: "var(--brand)" }}>{sub}</p>}
        <h2 className="text-xl font-bold text-slate-900">{label}</h2>
      </div>
      {action}
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
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 0.6);
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

  const T: Theme = business?.theme || THEMES.onyx;
  const brand = T.brand;

  // RGB breakdown for glow effects
  const br = parseInt(brand.slice(1, 3) || "C9", 16);
  const bg2 = parseInt(brand.slice(3, 5) || "A8", 16);
  const bb = parseInt(brand.slice(5, 7) || "4C", 16);
  const brandRgb = `${br},${bg2},${bb}`;

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

  type PortfolioWork = { imageUrl: string; staffName: string; staffAvatar: string | null };
  const portfolioWorks: PortfolioWork[] = staff
    .filter(s => s.portfolio.length > 0)
    .flatMap(s => s.portfolio.map(p => ({ imageUrl: p.imageUrl, staffName: s.name, staffAvatar: s.avatarUrl })));

  // Global CSS — only the brand color comes from the theme.
  // All backgrounds, text and fonts are forced to match the admin's clean slate palette.
  const cssVars = `
    :root {
      --brand: ${brand};
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: var(--font-heebo), system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
  `;

  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900" dir="rtl">
      <style>{cssVars}</style>

      {/* ══ STICKY HEADER (appears on scroll) ══════════════════════════════════ */}
      <header className="fixed top-0 inset-x-0 z-50 transition-all duration-300"
        style={{
          transform: scrolled ? "translateY(0)" : "translateY(-110%)",
          opacity: scrolled ? 1 : 0,
          pointerEvents: scrolled ? "auto" : "none",
          background: "rgba(255,255,255,0.97)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "1px solid #E2E8F0",
        }}>
        <div className="flex items-center gap-3 px-4 py-3">
          {business?.logoUrl && (
            <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 border border-slate-200">
              <img src={business.logoUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <p className="flex-1 font-bold text-[15px] tracking-wide text-slate-900">
            {business?.name || "DOMINANT"}
          </p>
          <Link href="/book"
            className="flex-shrink-0 text-[12px] font-bold tracking-[0.1em] uppercase px-5 py-2 rounded-full text-white"
            style={{ background: brand }}>
            קבע תור
          </Link>
        </div>
      </header>

      {/* ══ HERO — full viewport, dark background ═══════════════════════════════ */}
      <section className="relative flex flex-col" style={{ minHeight: "100svh" }}>

        {/* Background: video → image → dark gradient */}
        {business?.heroVideoUrl ? (
          <video src={business.heroVideoUrl} autoPlay muted loop playsInline
            className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: "center 20%" }} />
        ) : business?.coverImageUrl ? (
          <img src={business.coverImageUrl} alt=""
            className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: "center 20%" }} />
        ) : (
          <div className="absolute inset-0" style={{ background: "linear-gradient(160deg,#0A0A0A 0%,#1A1510 100%)" }} />
        )}

        {/* Dark overlay */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0.65) 70%, rgba(0,0,0,0.97) 100%)" }} />

        {/* ── Social icons row ── */}
        <div className="relative z-10 flex justify-between items-start px-5 pt-14">
          <div className="flex gap-2">
            {social.waze && (
              <a href={social.waze} target="_blank" rel="noopener noreferrer"
                className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.18)" }}>
                <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]"><path fill="#33CCFF" d="M12 2C6.486 2 2 6.486 2 12c0 1.527.35 2.97.97 4.26L2 22l5.74-.97A9.953 9.953 0 0012 22c5.514 0 10-4.486 10-10S17.514 2 12 2zm-2 9a1 1 0 110-2 1 1 0 010 2zm4 0a1 1 0 110-2 1 1 0 010 2zm-5 3s1 2 3 2 3-2 3-2H9z" /></svg>
              </a>
            )}
            {social.facebook && (
              <a href={social.facebook} target="_blank" rel="noopener noreferrer"
                className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.18)" }}>
                <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
              </a>
            )}
            {business?.phone && (
              <a href={`tel:${business.phone}`}
                className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.18)" }}>
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
                style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.18)" }}>
                <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]"><path fill="#E4405F" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" /></svg>
              </a>
            )}
            {social.whatsapp && (
              <a href={social.whatsapp} target="_blank" rel="noopener noreferrer"
                className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.18)" }}>
                <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
              </a>
            )}
          </div>
        </div>

        {/* ── Center content ── */}
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 pt-4 pb-4">
          {business?.logoUrl && (
            <div className="mb-5 rounded-full overflow-hidden border-2 border-white/20"
              style={{
                width: 90, height: 90,
                boxShadow: `0 0 40px rgba(${brandRgb},0.4), 0 8px 32px rgba(0,0,0,0.6)`,
              }}>
              <img src={business.logoUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}

          <h1 className="text-white font-bold uppercase leading-none mb-2 tracking-widest"
            style={{ fontSize: "clamp(2rem,10vw,4.5rem)", textShadow: "0 2px 24px rgba(0,0,0,0.8)" }}>
            {business?.name || "DOMINANT"}
          </h1>
          <p className="text-white/40 tracking-[0.5em] text-[10px] mb-8 uppercase">barbershop</p>

          <Link href="/book"
            className="inline-flex items-center gap-2 font-bold text-[13px] tracking-[0.15em] uppercase px-10 py-4 rounded-full text-white active:scale-95 transition-transform"
            style={{
              background: brand,
              boxShadow: `0 8px 32px rgba(${brandRgb},0.5), 0 2px 8px rgba(0,0,0,0.3)`,
            }}>
            קבע תור עכשיו
          </Link>
        </div>

        {/* ── QUICK SLOTS — inside hero, visible without scrolling ── */}
        {!loading && quickSlots.length > 0 && (
          <div className="relative z-10 px-4 pb-6">
            <div className="flex items-center gap-2.5 mb-3 px-1">
              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
              </span>
              <span className="text-white text-[11px] tracking-[0.25em] uppercase font-bold">תורים פנויים עכשיו</span>
              <div className="flex-1 h-px bg-white/10" />
              <Link href="/book" className="text-white/50 text-[11px] hover:text-white/80 transition-colors">כל התורים ←</Link>
            </div>

            <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              {quickSlots.map((slot, i) => (
                <Link key={i}
                  href={`/book/confirm?staffId=${slot.staffId}&serviceId=${slot.serviceId}&date=${slot.date}&time=${slot.time}`}
                  className="flex-shrink-0 rounded-2xl p-3.5 active:scale-95 transition-all"
                  style={{
                    background: "rgba(255,255,255,0.10)",
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    border: "1px solid rgba(255,255,255,0.18)",
                    minWidth: 108,
                    animation: `slot-glow 3s ease-in-out ${(i % 4) * 0.4}s infinite`,
                  }}>
                  <p className="text-[18px] font-bold tracking-widest text-white leading-none mb-1.5" dir="ltr">{slot.time}</p>
                  <p className="text-[11px] text-white/75 font-medium">{slot.dayLabel}</p>
                  <p className="text-[10px] text-white/45 truncate mt-0.5">{slot.staffName}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════════════════
          ALL SECTIONS BELOW HERO — clean white/slate design, Heebo font
      ══════════════════════════════════════════════════════════════════════════ */}

      {/* ── Stories ── */}
      {!loading && stories.length > 0 && (
        <section className="bg-white border-b border-slate-100 pt-5 pb-2">
          <p className="text-[10px] font-bold tracking-[0.3em] uppercase px-5 mb-3" style={{ color: brand }}>Stories</p>
          <StoriesCarousel stories={stories} />
        </section>
      )}

      {/* ── Staff — choose your barber ── */}
      {staff.length > 0 && (
        <section className="bg-slate-50 py-10 border-b border-slate-100">
          <SecLabel label="הספרים שלנו" sub="The Team"
            action={
              <Link href="/book" className="text-[12px] font-semibold" style={{ color: brand }}>קבע תור →</Link>
            }
          />
          <div className="flex gap-3 overflow-x-auto px-5 pb-2 snap-x" style={{ scrollbarWidth: "none" }}>
            {staff.map(member => {
              const slot = quickSlots.find(s => s.staffId === member.id);
              const hasToday = slot?.dayLabel === "היום";
              return (
                <Link key={member.id} href={`/book/service?staffId=${member.id}`}
                  className="flex-shrink-0 snap-start active:scale-[0.97] transition-transform rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm"
                  style={{ width: 150 }}>
                  {/* Square avatar */}
                  <div className="relative" style={{ aspectRatio: "1/1" }}>
                    {member.avatarUrl ? (
                      <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl font-bold bg-slate-100 text-slate-400">
                        {member.name[0]}
                      </div>
                    )}
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 50%)" }} />
                    {/* Slot badge */}
                    {slot && (
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-bold"
                        style={{ background: brand, color: "#fff" }}>
                        ⚡ {slot.time}
                      </div>
                    )}
                    {/* Live dot */}
                    {hasToday && (
                      <div className="absolute bottom-2 right-2">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                        </span>
                      </div>
                    )}
                  </div>
                  {/* Info */}
                  <div className="px-3 py-2.5">
                    <p className="font-semibold text-[14px] text-slate-900 truncate">{member.name}</p>
                    {slot ? (
                      <p className="text-[11px] font-semibold mt-0.5" style={{ color: brand }}>{slot.dayLabel} · {slot.time}</p>
                    ) : (
                      <p className="text-[11px] text-slate-400 mt-0.5">לחץ לתאום תור</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Portfolio ── */}
      {!loading && portfolioWorks.length > 0 && (
        <section className="bg-white py-10 border-b border-slate-100">
          <SecLabel label="מהעבודות שלנו" sub="Portfolio"
            action={<Link href="/book" className="text-[12px] font-semibold" style={{ color: brand }}>בחר סגנון →</Link>}
          />
          <div className="flex gap-3 overflow-x-auto px-5 pb-2 snap-x snap-mandatory" style={{ scrollbarWidth: "none" }}>
            {portfolioWorks.map((work, i) => (
              <Link key={i} href="/book" className="flex-shrink-0 snap-start active:scale-[0.97] transition-transform" style={{ width: 155 }}>
                <div className="rounded-2xl overflow-hidden relative" style={{ aspectRatio: "3/4" }}>
                  <img src={work.imageUrl} alt={work.staffName} className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 45%, rgba(0,0,0,0.75) 100%)" }} />
                  <div className="absolute bottom-3 right-3 left-3 flex items-center gap-2">
                    {work.staffAvatar ? (
                      <img src={work.staffAvatar} alt="" className="w-6 h-6 rounded-full object-cover border-2 border-white/50 flex-shrink-0" />
                    ) : (
                      <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] text-white font-bold"
                        style={{ background: brand }}>{work.staffName[0]}</div>
                    )}
                    <span className="text-[11px] text-white font-semibold truncate">{work.staffName}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Announcements ── */}
      {announcements.length > 0 && (
        <section className="bg-slate-50 py-10 px-5 border-b border-slate-100">
          <SecLabel label="עדכונים" sub="Updates" />
          <div className="space-y-3">
            {announcements.map(ann => (
              <div key={ann.id} className="bg-white rounded-xl border border-slate-200 p-4 relative overflow-hidden shadow-sm">
                {ann.isPinned && (
                  <div className="absolute top-0 right-0 bottom-0 w-1 rounded-r-xl" style={{ background: brand }} />
                )}
                <p className="text-[13px] font-semibold text-slate-900 mb-1 pr-3">{ann.title}</p>
                {ann.content && <p className="text-[12px] text-slate-500 leading-relaxed pr-3">{ann.content}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Products ── */}
      {products.length > 0 && (
        <section className="bg-white py-10 border-b border-slate-100">
          <SecLabel label="מוצרים" sub="Shop" />
          <div className="flex gap-3 overflow-x-auto px-5 pb-2" style={{ scrollbarWidth: "none" }}>
            {products.map(product => (
              <div key={product.id} className="flex-shrink-0 rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm active:scale-[0.97] transition-transform" style={{ width: 155 }}>
                <div className="h-36 bg-slate-50 flex items-center justify-center overflow-hidden">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                  ) : <span className="text-3xl opacity-30">🧴</span>}
                </div>
                <div className="p-3.5">
                  <p className="text-[13px] font-semibold text-slate-900 mb-1 leading-tight">{product.name}</p>
                  {product.description && (
                    <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mb-2">{product.description}</p>
                  )}
                  <p className="text-[17px] font-bold" style={{ color: brand }}>₪{product.price}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── About ── */}
      {business?.about && (
        <section className="bg-slate-50 py-10 px-5 border-b border-slate-100">
          <SecLabel label="אודות" sub="About" />
          <p className="text-[14px] text-slate-600 leading-loose">{business.about}</p>
        </section>
      )}

      {/* ── Footer ── */}
      <FooterCTA />
      <div className="py-6 text-center bg-white border-t border-slate-100">
        <p className="text-[10px] tracking-[0.3em] uppercase text-slate-400">
          {business?.name || "DOMINANT"} &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
