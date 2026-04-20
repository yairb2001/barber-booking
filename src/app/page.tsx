"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";

type QuickSlot = {
  staffId: string;
  staffName: string;
  staffAvatar: string | null;
  date: string;
  dayLabel: string;
  time: string;
  serviceId: string;
  serviceName: string;
  price: number;
  duration: number;
};

type Staff = {
  id: string;
  name: string;
  avatarUrl: string | null;
  portfolio: { id: string; imageUrl: string; caption: string | null }[];
};

type Announcement = {
  id: string;
  title: string;
  content: string | null;
  isPinned: boolean;
};

type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
};

type BusinessInfo = {
  name: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  phone: string | null;
  address: string | null;
  about: string | null;
  socialLinks: {
    whatsapp?: string;
    instagram?: string;
    facebook?: string;
    tiktok?: string;
    waze?: string;
  };
};

// === Quick Slots Infinite Carousel ===
function QuickSlotsCarousel({ slots }: { slots: QuickSlot[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const autoScrollRef = useRef<NodeJS.Timeout | null>(null);

  const startAutoScroll = useCallback(() => {
    if (autoScrollRef.current) clearInterval(autoScrollRef.current);
    autoScrollRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % slots.length);
    }, 3000);
  }, [slots.length]);

  useEffect(() => {
    if (slots.length === 0) return;
    startAutoScroll();
    return () => {
      if (autoScrollRef.current) clearInterval(autoScrollRef.current);
    };
  }, [slots.length, startAutoScroll]);

  useEffect(() => {
    if (!scrollRef.current || slots.length === 0) return;
    const cardWidth = 112;
    scrollRef.current.scrollTo({
      left: activeIndex * cardWidth,
      behavior: "smooth",
    });
  }, [activeIndex, slots.length]);

  const handleTouchStart = () => {
    if (autoScrollRef.current) clearInterval(autoScrollRef.current);
  };

  const handleTouchEnd = () => {
    startAutoScroll();
  };

  if (slots.length === 0) return null;

  const displaySlots = [...slots, ...slots, ...slots];

  return (
    <div>
      <div
        ref={scrollRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="flex gap-2 overflow-x-auto scrollbar-hide"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <style jsx>{`div::-webkit-scrollbar { display: none; }`}</style>
        {displaySlots.map((slot, i) => (
          <Link
            key={i}
            href={`/book/confirm?staffId=${slot.staffId}&serviceId=${slot.serviceId}&date=${slot.date}&time=${slot.time}`}
            className="min-w-[104px] bg-neutral-800/70 hover:bg-neutral-700 transition rounded-lg p-2 border border-neutral-700/40 flex-shrink-0"
          >
            <div className="text-amber-400 font-bold text-sm">{slot.time}</div>
            <div className="text-[11px] text-neutral-300">{slot.dayLabel}</div>
            <div className="text-[11px] text-neutral-500 truncate">
              {slot.staffName}
            </div>
          </Link>
        ))}
      </div>
      <div className="flex justify-center gap-1 mt-1.5">
        {slots.map((_, i) => (
          <div
            key={i}
            className={`w-1.5 h-1.5 rounded-full transition-all ${
              i === activeIndex % slots.length
                ? "bg-amber-400 w-3"
                : "bg-neutral-700"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// === Portfolio Gallery Carousel (works like Cali) ===
function PortfolioGallery({ staff }: { staff: Staff[] }) {
  const works = staff
    .filter((s) => s.portfolio.length > 0)
    .flatMap((s) =>
      s.portfolio.map((p) => ({
        ...p,
        staffName: s.name,
        staffAvatar: s.avatarUrl,
      }))
    );

  if (works.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="text-center font-bold text-lg mb-4">עבודות נבחרות</h2>
      <div className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory">
        <style jsx>{`div::-webkit-scrollbar { display: none; }`}</style>
        {works.map((work, i) => (
          <div
            key={i}
            className="min-w-[260px] max-w-[280px] flex-shrink-0 snap-center"
          >
            <div className="relative rounded-2xl overflow-hidden bg-neutral-800 aspect-[3/4]">
              <img
                src={work.imageUrl}
                alt={work.caption || ""}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              {/* Fallback when no image */}
              <div className="absolute inset-0 flex items-center justify-center text-neutral-600">
                <svg
                  className="w-16 h-16"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              {/* Barber info overlay */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-12">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-neutral-700 border-2 border-white flex items-center justify-center overflow-hidden">
                    {work.staffAvatar ? (
                      <img
                        src={work.staffAvatar}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-sm text-neutral-300">
                        {work.staffName[0]}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-center mt-1 font-semibold text-sm">
                  {work.staffName}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  const [quickSlots, setQuickSlots] = useState<QuickSlot[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/quick-slots").then((r) => r.json()),
      fetch("/api/staff").then((r) => r.json()),
      fetch("/api/announcements").then((r) => r.json()),
      fetch("/api/products").then((r) => r.json()),
      fetch("/api/business").then((r) => r.json()),
    ])
      .then(([slots, staffData, ann, prod, biz]) => {
        setQuickSlots(slots);
        setStaff(staffData);
        setAnnouncements(ann);
        setProducts(prod);
        setBusiness(biz);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const socialLinks = business?.socialLinks || {};

  return (
    <div className="min-h-screen flex flex-col bg-white text-neutral-900">
      {/* ===== Cover Image ===== */}
      <div className="relative h-72">
        {business?.coverImageUrl ? (
          <img
            src={business.coverImageUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-b from-neutral-800 to-neutral-900" />
        )}

        {/* Social buttons on cover */}
        <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
          <div className="flex gap-2">
            {socialLinks.waze && (
              <a
                href={socialLinks.waze}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-xl bg-white/90 backdrop-blur flex items-center justify-center shadow-lg"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5">
                  <path
                    fill="#33CCFF"
                    d="M12 2C6.486 2 2 6.486 2 12c0 1.527.35 2.97.97 4.26L2 22l5.74-.97A9.953 9.953 0 0012 22c5.514 0 10-4.486 10-10S17.514 2 12 2zm-2 9a1 1 0 110-2 1 1 0 010 2zm4 0a1 1 0 110-2 1 1 0 010 2zm-5 3s1 2 3 2 3-2 3-2H9z"
                  />
                </svg>
              </a>
            )}
            {socialLinks.facebook && (
              <a
                href={socialLinks.facebook}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-xl bg-white/90 backdrop-blur flex items-center justify-center shadow-lg"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5">
                  <path
                    fill="#1877F2"
                    d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
                  />
                </svg>
              </a>
            )}
          </div>
          <div className="flex gap-2">
            {socialLinks.instagram && (
              <a
                href={socialLinks.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-xl bg-white/90 backdrop-blur flex items-center justify-center shadow-lg"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5">
                  <path
                    fill="#E4405F"
                    d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"
                  />
                </svg>
              </a>
            )}
            {socialLinks.whatsapp && (
              <a
                href={socialLinks.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-xl bg-white/90 backdrop-blur flex items-center justify-center shadow-lg"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5">
                  <path
                    fill="#25D366"
                    d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
                  />
                </svg>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ===== Logo + Business Name ===== */}
      <div className="flex flex-col items-center -mt-12 relative z-10">
        <div className="w-24 h-24 rounded-full bg-neutral-900 border-4 border-white shadow-xl flex items-center justify-center overflow-hidden">
          {business?.logoUrl ? (
            <img
              src={business.logoUrl}
              alt={business?.name || ""}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-center">
              <div className="text-amber-400 font-bold text-xs leading-tight">
                DOMINANT
              </div>
              <div className="text-amber-400 text-[8px]">✂</div>
            </div>
          )}
        </div>
        <h1 className="font-bold text-xl mt-2">
          {business?.name || "DOMINANT barbershop"}
        </h1>
      </div>

      {/* ===== Quick Slots (animated compact carousel) ===== */}
      {!loading && quickSlots.length > 0 && (
        <div className="px-4 mt-4">
          <div className="bg-neutral-50 rounded-xl p-3 border border-neutral-200">
            <h2 className="text-sm font-semibold text-amber-600 mb-2">
              🔥 תורים קרובים פנויים
            </h2>
            <QuickSlotsCarousel slots={quickSlots} />
          </div>
        </div>
      )}

      {/* ===== Book Button ===== */}
      <div className="px-8 mt-4">
        <Link
          href="/book"
          className="flex items-center justify-center gap-2 w-full bg-neutral-900 hover:bg-neutral-800 text-white font-bold text-center py-3.5 rounded-full text-lg transition shadow-lg"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          זימון תור
        </Link>
      </div>

      {/* ===== Announcements ===== */}
      {announcements.length > 0 && (
        <div className="mt-6">
          <h2 className="text-center font-bold text-lg mb-3">עדכונים חשובים</h2>
          <div className="px-4 space-y-3">
            {announcements.map((ann) => (
              <div
                key={ann.id}
                className="relative bg-neutral-50 rounded-2xl p-4 border border-neutral-200 shadow-sm"
              >
                {ann.isPinned && (
                  <span className="absolute -top-2 -left-1 text-red-500 text-lg">
                    📌
                  </span>
                )}
                <h3 className="font-bold text-center">{ann.title}</h3>
                {ann.content && (
                  <p className="text-sm text-neutral-600 mt-2 text-center leading-relaxed">
                    {ann.content}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== Portfolio / Works Gallery ===== */}
      {!loading && <PortfolioGallery staff={staff} />}

      {/* ===== Product Catalog ===== */}
      {products.length > 0 && (
        <div className="mt-6">
          <h2 className="text-center font-bold text-lg mb-3">קטלוג המוצרים</h2>
          <div className="flex gap-3 overflow-x-auto px-4 pb-2">
            <style jsx>{`div::-webkit-scrollbar { display: none; }`}</style>
            {products.map((product) => (
              <div
                key={product.id}
                className="min-w-[160px] max-w-[180px] bg-white rounded-2xl border border-neutral-200 overflow-hidden flex-shrink-0 shadow-sm"
              >
                <div className="h-32 bg-neutral-100 flex items-center justify-center">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-4xl">🧴</span>
                  )}
                </div>
                <div className="p-3">
                  <h3 className="text-sm font-semibold">{product.name}</h3>
                  {product.description && (
                    <p className="text-[11px] text-neutral-500 mt-0.5 line-clamp-2">
                      {product.description}
                    </p>
                  )}
                  <div className="bg-amber-500 text-white font-bold text-sm mt-2 py-1 px-3 rounded-full text-center inline-block">
                    ₪ {product.price}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== About ===== */}
      {business?.about && (
        <div className="mt-6 px-4">
          <div className="rounded-2xl overflow-hidden border border-neutral-200 shadow-sm">
            {business.coverImageUrl && (
              <img
                src={business.coverImageUrl}
                alt=""
                className="w-full h-40 object-cover"
              />
            )}
            <div className="text-center py-3">
              <span className="text-sm text-neutral-600 font-medium">
                על העסק
              </span>
            </div>
          </div>
          <p className="text-sm text-neutral-600 mt-3 text-center leading-relaxed">
            {business.about}
          </p>
        </div>
      )}

      {/* ===== Business Hours ===== */}
      <div className="px-4 mt-6">
        <div className="bg-neutral-50 rounded-2xl p-4 border border-neutral-200">
          <h3 className="font-bold text-center mb-3">שעות פעילות</h3>
          <div className="text-sm text-neutral-600 space-y-2">
            <div className="flex justify-between">
              <span>09:00 - 20:00</span>
              <span className="font-medium">ראשון - חמישי</span>
            </div>
            <div className="flex justify-between">
              <span>08:00 - 14:00</span>
              <span className="font-medium">שישי</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">סגור</span>
              <span className="font-medium">שבת</span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Footer ===== */}
      <div className="px-4 py-8 mt-6 text-center text-neutral-400 text-xs">
        DOMINANT Barbershop © {new Date().getFullYear()}
      </div>
    </div>
  );
}
