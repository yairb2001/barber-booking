"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";

// === Types ===
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
  name: string; logoUrl: string | null; coverImageUrl: string | null;
  brandColor: string | null; bgColor: string | null;
  phone: string | null; address: string | null; about: string | null;
  socialLinks: { whatsapp?: string; instagram?: string; facebook?: string; tiktok?: string; waze?: string };
};

type PortfolioWork = { imageUrl: string; staffName: string; staffAvatar: string | null };

// === Stories Carousel ===
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
    const duration = 5000;
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / duration) * 100, 100);
      setProgress(pct);
      if (elapsed >= duration) { clearInterval(timerRef.current!); goNext(); }
    }, 50);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx]);

  if (stories.length === 0) return null;
  const activeStory = activeIdx !== null ? stories[activeIdx] : null;

  return (
    <>
      <div className="flex gap-4 px-4 py-2 overflow-x-auto" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
        <style jsx>{`div::-webkit-scrollbar { display: none; }`}</style>
        {stories.map((story, idx) => (
          <button key={story.id} onClick={() => openStory(idx)} className="flex flex-col items-center gap-1 flex-shrink-0">
            <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-[var(--brand)] shadow-sm">
              <img src={story.mediaUrl} alt={story.caption || ""} className="w-full h-full object-cover" />
            </div>
            {story.caption && <span className="text-xs text-neutral-500 w-16 truncate text-center">{story.caption}</span>}
          </button>
        ))}
      </div>

      {activeStory && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col" onClick={closeStory}>
          <div className="flex gap-1 p-3">
            {stories.map((_, i) => (
              <div key={i} className="h-0.5 flex-1 bg-white/30 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full transition-none"
                  style={{ width: i < activeIdx! ? "100%" : i === activeIdx ? `${progress}%` : "0%" }} />
              </div>
            ))}
          </div>
          <div className="flex-1 flex items-center justify-center">
            <img src={activeStory.mediaUrl} alt={activeStory.caption || ""} className="max-h-[80vh] w-full object-contain" />
          </div>
          {activeStory.caption && (
            <div className="absolute bottom-16 inset-x-0 text-center px-6">
              <p className="text-white text-sm drop-shadow-md">{activeStory.caption}</p>
            </div>
          )}
          <button onClick={goPrev} className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white text-xl hover:bg-white/30 transition">‹</button>
          <button onClick={goNext} className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white text-xl hover:bg-white/30 transition">›</button>
        </div>
      )}
    </>
  );
}

// === Quick Slots Carousel ===
function QuickSlotsCarousel({ slots }: { slots: QuickSlot[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const autoScrollRef = useRef<NodeJS.Timeout | null>(null);

  const startAutoScroll = useCallback(() => {
    if (autoScrollRef.current) clearInterval(autoScrollRef.current);
    autoScrollRef.current = setInterval(() => { setActiveIndex((prev) => (prev + 1) % slots.length); }, 3000);
  }, [slots.length]);

  useEffect(() => {
    if (slots.length === 0) return;
    startAutoScroll();
    return () => { if (autoScrollRef.current) clearInterval(autoScrollRef.current); };
  }, [slots.length, startAutoScroll]);

  useEffect(() => {
    if (!scrollRef.current || slots.length === 0) return;
    scrollRef.current.scrollTo({ left: activeIndex * 112, behavior: "smooth" });
  }, [activeIndex, slots.length]);

  if (slots.length === 0) return null;
  const displaySlots = [...slots, ...slots, ...slots];

  return (
    <div>
      <div ref={scrollRef} onTouchStart={() => { if (autoScrollRef.current) clearInterval(autoScrollRef.current); }}
        onTouchEnd={startAutoScroll} className="flex gap-2 overflow-x-auto"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
        <style jsx>{`div::-webkit-scrollbar { display: none; }`}</style>
        {displaySlots.map((slot, i) => (
          <Link key={i}
            href={`/book/confirm?staffId=${slot.staffId}&serviceId=${slot.serviceId}&date=${slot.date}&time=${slot.time}`}
            className="min-w-[108px] bg-white hover:bg-neutral-50 transition-colors rounded-2xl p-3 border border-neutral-200 flex-shrink-0 shadow-sm">
            <div className="text-[var(--brand)] font-light text-base tracking-widest" dir="ltr">{slot.time}</div>
            <div className="text-[11px] text-neutral-400 mt-0.5">{slot.dayLabel}</div>
            <div className="text-[11px] text-neutral-500 truncate mt-0.5">{slot.staffName}</div>
          </Link>
        ))}
      </div>
      <div className="flex justify-center gap-1.5 mt-3">
        {slots.map((_, i) => (
          <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === activeIndex % slots.length ? "bg-[var(--brand)] w-4" : "bg-neutral-200 w-1.5"}`} />
        ))}
      </div>
    </div>
  );
}

// === Hero Portfolio Marquee ===
function HeroMarquee({ works }: { works: PortfolioWork[] }) {
  if (works.length === 0) return null;
  const doubled = [...works, ...works, ...works];
  const speed = Math.max(20, works.length * 4);
  return (
    <div className="overflow-hidden w-full">
      <style jsx>{`
        @keyframes heroMarquee {
          from { transform: translateX(0); }
          to { transform: translateX(-33.333%); }
        }
        .marquee-track {
          animation: heroMarquee ${speed}s linear infinite;
        }
      `}</style>
      <div className="marquee-track flex gap-2">
        {doubled.map((work, i) => (
          <div key={i} className="flex-shrink-0 w-20 h-28 rounded-xl overflow-hidden opacity-80 border border-white/10">
            <img src={work.imageUrl} alt="" className="w-full h-full object-cover" />
          </div>
        ))}
      </div>
    </div>
  );
}

// === Section Header ===
function SectionHeader({ en, he, brandColor }: { en: string; he: string; brandColor: string }) {
  return (
    <div className="flex items-center gap-3 px-5 mb-6">
      <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: brandColor }} />
      <div>
        <p className="text-[10px] tracking-[0.25em] text-[var(--brand)] uppercase">{en}</p>
        <h2 className="text-sm tracking-[0.15em] font-medium text-neutral-800">{he}</h2>
      </div>
    </div>
  );
}

// === Main Page ===
export default function HomePage() {
  const [quickSlots, setQuickSlots] = useState<QuickSlot[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/quick-slots").then((r) => r.json()),
      fetch("/api/staff").then((r) => r.json()),
      fetch("/api/announcements").then((r) => r.json()),
      fetch("/api/products").then((r) => r.json()),
      fetch("/api/business").then((r) => r.json()),
      fetch("/api/stories").then((r) => r.json()).catch(() => []),
    ])
      .then(([slots, staffData, ann, prod, biz, storiesData]) => {
        setQuickSlots(slots);
        setStaff(staffData);
        setAnnouncements(ann);
        setProducts(prod);
        setBusiness(biz);
        setStories(Array.isArray(storiesData) ? storiesData : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const brandColor = business?.brandColor || "#D4AF37";

  // Portfolio works for marquee
  const portfolioWorks: PortfolioWork[] = staff
    .filter((s) => s.portfolio.length > 0)
    .flatMap((s) => s.portfolio.map((p) => ({ imageUrl: p.imageUrl, staffName: s.name, staffAvatar: s.avatarUrl })));

  // Social links
  const rawSocial = business?.socialLinks || {};
  function toSocialUrl(key: string, val: string): string {
    if (!val) return "";
    if (val.startsWith("http")) return val;
    if (key === "whatsapp") { const digits = val.replace(/\D/g, ""); return `https://wa.me/${digits}`; }
    if (key === "instagram") return `https://instagram.com/${val.replace("@", "")}`;
    if (key === "facebook")  return `https://facebook.com/${val.replace("@", "")}`;
    return val;
  }
  const socialLinks = {
    whatsapp:  toSocialUrl("whatsapp",  rawSocial.whatsapp  || ""),
    instagram: toSocialUrl("instagram", rawSocial.instagram || ""),
    facebook:  toSocialUrl("facebook",  rawSocial.facebook  || ""),
    waze:      rawSocial.waze || "",
  };

  return (
    <div className="min-h-screen flex flex-col text-neutral-900 bg-white" dir="rtl">
      <style>{`:root { --brand: ${brandColor}; }`}</style>

      {/* ===== Hero ===== */}
      <div className="relative min-h-screen max-h-[780px]">

        {/* Background */}
        {business?.coverImageUrl ? (
          <img src={business.coverImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-neutral-800 via-neutral-700 to-neutral-900" />
        )}

        {/* Dark overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/40" />

        {/* Social icons — top */}
        <div className="absolute top-6 inset-x-0 flex justify-between px-5 z-10">
          <div className="flex gap-2">
            {socialLinks.waze && (
              <a href={socialLinks.waze} target="_blank" rel="noopener noreferrer"
                className="w-9 h-9 rounded-full bg-white/80 backdrop-blur-md border border-white/60 flex items-center justify-center hover:bg-white transition-colors shadow-sm">
                <svg viewBox="0 0 24 24" className="w-4 h-4"><path fill="#33CCFF" d="M12 2C6.486 2 2 6.486 2 12c0 1.527.35 2.97.97 4.26L2 22l5.74-.97A9.953 9.953 0 0012 22c5.514 0 10-4.486 10-10S17.514 2 12 2zm-2 9a1 1 0 110-2 1 1 0 010 2zm4 0a1 1 0 110-2 1 1 0 010 2zm-5 3s1 2 3 2 3-2 3-2H9z" /></svg>
              </a>
            )}
            {socialLinks.facebook && (
              <a href={socialLinks.facebook} target="_blank" rel="noopener noreferrer"
                className="w-9 h-9 rounded-full bg-white/80 backdrop-blur-md border border-white/60 flex items-center justify-center hover:bg-white transition-colors shadow-sm">
                <svg viewBox="0 0 24 24" className="w-4 h-4"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
              </a>
            )}
          </div>
          <div className="flex gap-2">
            {socialLinks.instagram && (
              <a href={socialLinks.instagram} target="_blank" rel="noopener noreferrer"
                className="w-9 h-9 rounded-full bg-white/80 backdrop-blur-md border border-white/60 flex items-center justify-center hover:bg-white transition-colors shadow-sm">
                <svg viewBox="0 0 24 24" className="w-4 h-4"><path fill="#E4405F" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" /></svg>
              </a>
            )}
            {socialLinks.whatsapp && (
              <a href={socialLinks.whatsapp} target="_blank" rel="noopener noreferrer"
                className="w-9 h-9 rounded-full bg-white/80 backdrop-blur-md border border-white/60 flex items-center justify-center hover:bg-white transition-colors shadow-sm">
                <svg viewBox="0 0 24 24" className="w-4 h-4"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
              </a>
            )}
          </div>
        </div>

        {/* Hero centered content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10 pb-36">
          {/* Logo */}
          <div className="w-32 h-32 rounded-full border-2 border-white/60 bg-white/20 backdrop-blur-sm flex items-center justify-center mb-6 overflow-hidden shadow-lg">
            {business?.logoUrl ? (
              <img src={business.logoUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="text-white font-light text-xs tracking-[0.2em] uppercase">
                {business?.name?.charAt(0) || "D"}
              </div>
            )}
          </div>

          {/* Business name */}
          <h1 className="text-3xl font-light tracking-[0.3em] uppercase text-white mb-2 drop-shadow-md">
            {business?.name || "DOMINANT"}
          </h1>
          <p className="text-[11px] tracking-[0.25em] text-white/60 uppercase mb-3">Barbershop</p>

          {/* Tagline */}
          <p className="text-sm text-white/80 mb-8 tracking-wide font-light">
            בחר סגנון שאהבת וקבע תור
          </p>

          {/* CTA */}
          <Link
            href="/book"
            className="inline-flex items-center gap-3 font-semibold text-sm tracking-[0.15em] uppercase px-8 py-4 rounded-full transition-colors shadow-lg"
            style={{ backgroundColor: brandColor, color: "#fff" }}
          >
            זמן תור עכשיו
            <span className="text-base">←</span>
          </Link>
        </div>

        {/* Portfolio marquee — bottom of hero */}
        {!loading && portfolioWorks.length > 0 && (
          <div className="absolute bottom-16 inset-x-0 z-10">
            <HeroMarquee works={portfolioWorks} />
          </div>
        )}

        {/* Bottom fade */}
        <div className="absolute bottom-0 inset-x-0 h-20 bg-gradient-to-t from-white to-transparent" />
      </div>

      {/* ===== Stories ===== */}
      {!loading && stories.length > 0 && (
        <div className="px-1 pt-4 pb-2 border-b border-neutral-100">
          <StoriesCarousel stories={stories} />
        </div>
      )}

      {/* ===== תורים מהירים ===== */}
      {!loading && quickSlots.length > 0 && (
        <div className="px-5 py-8 border-b border-neutral-100">
          <SectionHeader en="Available Now" he="תורים פנויים היום" brandColor={brandColor} />
          <QuickSlotsCarousel slots={quickSlots} />
        </div>
      )}

      {/* ===== צוות הספרים ===== */}
      {staff.length > 0 && (
        <div className="py-10 border-b border-neutral-100">
          <SectionHeader en="The Team" he="הספרים שלנו" brandColor={brandColor} />
          <div className="flex gap-4 overflow-x-auto px-5 pb-2" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
            <style jsx>{`div::-webkit-scrollbar { display: none; }`}</style>
            {staff.map((member) => (
              <Link key={member.id} href={`/book/service?staffId=${member.id}`}
                className="min-w-[150px] max-w-[150px] flex-shrink-0 group">
                <div className="aspect-[3/4] bg-neutral-100 rounded-2xl overflow-hidden mb-3 relative shadow-md border border-neutral-100">
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt={member.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-4xl font-light text-neutral-300">{member.name[0]}</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-[var(--brand)]/0 group-hover:bg-[var(--brand)]/8 transition-colors rounded-2xl" />
                </div>
                <div className="text-center">
                  <p className="text-xs tracking-[0.15em] font-medium text-neutral-700">{member.name}</p>
                  <p className="text-[10px] text-[var(--brand)] mt-1 opacity-0 group-hover:opacity-100 transition-opacity">בחירה →</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ===== עדכונים ===== */}
      {announcements.length > 0 && (
        <div className="py-10 px-5 border-b border-neutral-100">
          <SectionHeader en="Updates" he="עדכונים" brandColor={brandColor} />
          <div className="space-y-3">
            {announcements.map((ann) => (
              <div key={ann.id} className="bg-neutral-50 rounded-2xl border border-neutral-100 p-4 relative overflow-hidden">
                {ann.isPinned && (
                  <div className="absolute top-0 right-0 w-1 h-full rounded-r-2xl" style={{ backgroundColor: brandColor }} />
                )}
                <h3 className="text-sm font-medium text-neutral-800 mb-1.5 pr-3">{ann.title}</h3>
                {ann.content && <p className="text-xs text-neutral-500 leading-relaxed">{ann.content}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== מוצרים ===== */}
      {products.length > 0 && (
        <div className="py-10 border-b border-neutral-100">
          <SectionHeader en="Shop" he="מוצרים" brandColor={brandColor} />
          <div className="flex gap-3 overflow-x-auto px-5 pb-2" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
            <style jsx>{`div::-webkit-scrollbar { display: none; }`}</style>
            {products.map((product) => (
              <div key={product.id}
                className="min-w-[150px] max-w-[160px] bg-white rounded-2xl border border-neutral-100 overflow-hidden flex-shrink-0 shadow-sm">
                <div className="h-36 bg-neutral-50 flex items-center justify-center overflow-hidden rounded-t-2xl">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 border border-neutral-200 rounded-xl flex items-center justify-center text-neutral-300 text-xl">🧴</div>
                  )}
                </div>
                <div className="p-3">
                  <h3 className="text-xs font-medium text-neutral-800">{product.name}</h3>
                  {product.description && <p className="text-[10px] text-neutral-400 mt-1 line-clamp-2 leading-relaxed">{product.description}</p>}
                  <div className="text-[var(--brand)] text-sm font-medium mt-2">₪{product.price}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== אודות ===== */}
      {business?.about && (
        <div className="py-10 px-5 border-b border-neutral-100">
          <SectionHeader en="About" he="אודות" brandColor={brandColor} />
          <p className="text-sm text-neutral-600 leading-relaxed">{business.about}</p>
        </div>
      )}

      {/* ===== Footer ===== */}
      <div className="py-10 text-center">
        <p className="text-[10px] tracking-[0.3em] text-neutral-400 uppercase">
          {business?.name || "DOMINANT"} &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
