"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type QuickSlot = {
  staffId: string;
  staffName: string;
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
  nickname: string | null;
  avatarUrl: string | null;
  isAvailable: boolean;
};

// Progress dots component
function ProgressDots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={`rounded-full transition-all duration-300 ${
            i === step
              ? "w-4 h-2 bg-[var(--brand)]"
              : i < step
              ? "w-2 h-2 bg-[var(--brand)/60]"
              : "w-2 h-2 bg-neutral-200"
          }`}
        />
      ))}
    </div>
  );
}

export default function ChooseBarberPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [quickSlots, setQuickSlots] = useState<QuickSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [brandColor, setBrandColor] = useState("#D4AF37");

  useEffect(() => {
    Promise.all([
      fetch("/api/staff").then((r) => r.json()),
      fetch("/api/quick-slots").then((r) => r.json()),
      fetch("/api/business").then((r) => r.json()).catch(() => null),
    ])
      .then(([staffData, slots, biz]) => {
        setStaff(staffData);
        setQuickSlots(slots);
        if (biz?.brandColor) setBrandColor(biz.brandColor);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Find nearest slot per barber
  const getBarberSlot = (staffId: string) =>
    quickSlots.find((s) => s.staffId === staffId);

  return (
    <div className="min-h-screen bg-[#faf9f7]" dir="rtl">
      {/* ===== Sticky Header ===== */}
      <div className="sticky top-0 z-20 bg-[#faf9f7]/95 backdrop-blur-md border-b border-neutral-100 px-5 py-4">
        <div className="flex items-center justify-between">
          {/* Back arrow */}
          <Link
            href="/"
            className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-neutral-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>

          {/* Title */}
          <h1 className="text-[11px] tracking-[0.25em] font-light uppercase text-neutral-600">
            בחר ספר
          </h1>

          {/* Progress dots */}
          <ProgressDots step={1} />
        </div>
      </div>

      {/* ===== Quick Slots Strip ===== */}
      {!loading && quickSlots.length > 0 && (
        <div className="px-5 pt-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-1 h-3 bg-[var(--brand)] rounded-full" />
            <p className="text-[10px] tracking-[0.25em] text-[var(--brand)] uppercase">זמין היום</p>
          </div>
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            <style jsx>{`div::-webkit-scrollbar { display: none; }`}</style>
            {quickSlots.map((slot, i) => (
              <Link
                key={i}
                href={`/book/confirm?staffId=${slot.staffId}&serviceId=${slot.serviceId}&date=${slot.date}&time=${slot.time}`}
                className="min-w-[100px] bg-white hover:bg-[var(--brand)/8] border border-neutral-200 rounded-2xl flex-shrink-0 p-3 transition-colors shadow-sm"
              >
                <div className="font-light text-sm tracking-widest" dir="ltr" style={{ color: brandColor }}>
                  {slot.time}
                </div>
                <div className="text-[10px] text-neutral-400 mt-0.5">{slot.dayLabel}</div>
                <div className="text-[10px] text-neutral-500 truncate mt-0.5">{slot.staffName}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ===== Divider ===== */}
      {!loading && quickSlots.length > 0 && (
        <div className="h-px bg-neutral-100 mx-5 mt-6" />
      )}

      {/* ===== Staff Grid ===== */}
      <div className="p-5 pt-6">
        {loading ? (
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="aspect-[3/4] bg-neutral-100 animate-pulse rounded-2xl"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {staff.map((member) => {
              const nearestSlot = getBarberSlot(member.id);

              return (
                <Link
                  key={member.id}
                  href={`/book/service?staffId=${member.id}`}
                  className="group block bg-white rounded-2xl overflow-hidden hover:border-[var(--brand)/30] hover:shadow-md transition-all shadow-sm border border-neutral-100"
                >
                  {/* Avatar — portrait ratio */}
                  <div className="aspect-[3/4] bg-stone-50 relative overflow-hidden">
                    {member.avatarUrl ? (
                      <img
                        src={member.avatarUrl}
                        alt={member.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-3xl font-light text-neutral-300">
                          {member.name[0]}
                        </span>
                      </div>
                    )}
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-[var(--brand)]/0 group-hover:bg-[var(--brand)]/5 transition-colors" />
                    {/* Available badge — top-right */}
                    {member.isAvailable && (
                      <div className="absolute top-1.5 right-1.5">
                        <span className="text-[8px] tracking-wider bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full px-1.5 py-0.5">
                          זמין
                        </span>
                      </div>
                    )}
                    {/* Nearest slot badge */}
                    {nearestSlot && (
                      <div className="absolute bottom-1.5 right-1.5 bg-white/90 backdrop-blur-sm border border-[var(--brand)/30] rounded-lg px-1.5 py-0.5 shadow-sm">
                        <span className="text-[var(--brand)] text-[9px] font-light tracking-widest" dir="ltr">{nearestSlot.time}</span>
                      </div>
                    )}
                  </div>

                  {/* Name */}
                  <div className="px-2 py-2">
                    <p className="text-sm font-medium text-neutral-700 truncate">
                      {member.name}
                    </p>
                    {member.nickname && (
                      <p className="text-[9px] text-neutral-400 mt-0.5 tracking-wider truncate">
                        {member.nickname}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
