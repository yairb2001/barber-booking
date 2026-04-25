"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMinutes: number;
  color: string | null;
  note: string | null;
  customPrice: number | null;
  customDuration: number | null;
};

type QuickSlot = {
  staffId: string;
  date: string;
  dayLabel: string;
  time: string;
  serviceId: string;
  price: number;
  duration: number;
};

type StaffInfo = {
  id: string;
  name: string;
  avatarUrl: string | null;
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

function ChooseServicePageContent() {
  const searchParams = useSearchParams();
  const staffId = searchParams.get("staffId");
  const [services, setServices] = useState<Service[]>([]);
  const [quickSlots, setQuickSlots] = useState<QuickSlot[]>([]);
  const [staffInfo, setStaffInfo] = useState<StaffInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!staffId) return;
    Promise.all([
      fetch(`/api/services?staffId=${staffId}`).then((r) => r.json()),
      fetch(`/api/quick-slots?staffId=${staffId}`).then((r) => r.json()),
      fetch("/api/staff").then((r) => r.json()),
    ]).then(([svc, slots, allStaff]) => {
      setServices(svc);
      setQuickSlots(slots);
      const found = allStaff.find((s: StaffInfo) => s.id === staffId);
      if (found) setStaffInfo(found);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [staffId]);

  return (
    <div className="min-h-screen bg-[#faf9f7]" dir="rtl">
      {/* ===== Sticky Header ===== */}
      <div className="sticky top-0 z-20 bg-[#faf9f7]/95 backdrop-blur-md border-b border-neutral-100 px-5 py-4">
        <div className="flex items-center justify-between">
          {/* Back arrow */}
          <Link
            href="/book"
            className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-neutral-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>

          {/* Title — shows barber name if available */}
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-[11px] tracking-[0.25em] font-light uppercase text-neutral-600">
              בחר שירות
            </h1>
            {staffInfo && (
              <p className="text-[9px] tracking-[0.2em] text-[var(--brand)] uppercase">{staffInfo.name}</p>
            )}
          </div>

          {/* Progress dots — step 2 */}
          <ProgressDots step={2} />
        </div>
      </div>

      {/* ===== Quick Slots for this barber ===== */}
      {!loading && quickSlots.length > 0 && (
        <div className="px-5 pt-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-1 h-3 bg-[var(--brand)] rounded-full" />
            <p className="text-[10px] tracking-[0.25em] text-[var(--brand)] uppercase">
              זמין היום — {staffInfo?.name}
            </p>
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
                className="min-w-[96px] bg-[var(--brand)/8] hover:bg-[var(--brand)/15] border border-[var(--brand)/30] rounded-2xl flex-shrink-0 p-3 text-center transition-colors shadow-sm"
              >
                <div className="text-[var(--brand)] font-light text-sm tracking-widest" dir="ltr">{slot.time}</div>
                <div className="text-[10px] text-[var(--brand)]/70 mt-0.5">{slot.dayLabel}</div>
                <div className="text-[10px] text-[var(--brand)]/50 mt-0.5">{slot.duration} דק׳</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ===== Divider / label ===== */}
      <div className="px-5 pt-6 pb-3">
        <div className="h-px bg-neutral-100" />
        <p className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase mt-4">
          בחר שירות לראות את כל השעות הפנויות
        </p>
      </div>

      {/* ===== Services List ===== */}
      <div className="px-5 pb-8 space-y-2">
        {loading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-neutral-100 animate-pulse rounded-2xl" />
          ))
        ) : (
          services.map((service) => {
            const price = service.customPrice ?? service.price;
            const duration = service.customDuration ?? service.durationMinutes;

            return (
              <Link
                key={service.id}
                href={`/book/time?staffId=${staffId}&serviceId=${service.id}`}
                className="flex items-stretch bg-white rounded-2xl border border-neutral-100 hover:border-[var(--brand)/30] hover:shadow-md transition-all group overflow-hidden shadow-sm"
              >
                {/* Gold left-border accent (right in RTL = visual left) */}
                <div className="w-[3px] bg-[var(--brand)] group-hover:bg-[var(--brand)] flex-shrink-0 transition-colors rounded-r-2xl" />

                {/* Content */}
                <div className="flex items-center justify-between px-4 py-4 flex-1">
                  <div className="flex-1 min-w-0 ml-4">
                    <h3 className="text-sm tracking-[0.08em] font-light text-neutral-900">{service.name}</h3>
                    {service.description && (
                      <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed line-clamp-2">{service.description}</p>
                    )}
                    {service.note && (
                      <p className="text-[10px] text-neutral-400 mt-1">{service.note}</p>
                    )}
                    <p className="text-[10px] text-neutral-400 mt-2 tracking-wider">
                      {duration} דקות
                    </p>
                  </div>

                  {/* Price */}
                  <div className="text-left flex-shrink-0">
                    <span className="text-[var(--brand)] text-lg font-light tracking-wide">₪{price}</span>
                  </div>
                </div>

                {/* Arrow */}
                <div className="flex items-center px-3 text-neutral-300 group-hover:text-[var(--brand)] transition-colors text-sm">
                  ←
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function ChooseServicePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#faf9f7] flex items-center justify-center">
          <div className="text-[10px] tracking-[0.3em] text-neutral-400 uppercase">טוען...</div>
        </div>
      }
    >
      <ChooseServicePageContent />
    </Suspense>
  );
}
