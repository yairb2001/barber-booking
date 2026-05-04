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
  showDuration: boolean;
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

// ── Step bar ───────────────────────────────────────────────────────────────────
function StepBar({ step }: { step: number }) {
  const steps = ["ספר", "שירות", "זמן"];
  return (
    <div className="flex items-center gap-0">
      {steps.map((label, i) => {
        const idx = i + 1;
        const active = idx === step;
        const done = idx < step;
        return (
          <div key={idx} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all"
                style={{
                  background: active ? "var(--brand)" : done ? "var(--brand)" : "var(--divider)",
                  color: active || done ? "#000" : "var(--text-muted)",
                }}>
                {done ? "✓" : idx}
              </div>
              <span className="text-[9px] tracking-wide mt-0.5 font-medium"
                style={{ color: active ? "var(--brand)" : "var(--text-muted)" }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="w-8 h-px mx-1 mb-4 transition-all"
                style={{ background: done ? "var(--brand)" : "var(--divider)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
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
      fetch(`/api/services?staffId=${staffId}`).then(r => r.json()),
      fetch(`/api/quick-slots?staffId=${staffId}`).then(r => r.json()),
      fetch("/api/staff").then(r => r.json()),
    ]).then(([svc, slots, allStaff]) => {
      setServices(svc);
      setQuickSlots(slots);
      const found = allStaff.find((s: StaffInfo) => s.id === staffId);
      if (found) setStaffInfo(found);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [staffId]);

  return (
    <div className="min-h-screen pb-24" dir="rtl" style={{ background: "var(--bg)" }}>

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-20 px-4 py-3"
        style={{ background: "var(--header-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--divider)" }}>
        <div className="flex items-center justify-between">
          <BackArrow href="/book" />

          {/* Title + barber */}
          <div className="flex flex-col items-center gap-0.5">
            <h1 className="text-[13px] font-semibold tracking-[0.12em]" style={{ color: "var(--text-pri)" }}>
              בחירת שירות
            </h1>
            {staffInfo && (
              <div className="flex items-center gap-1.5">
                {staffInfo.avatarUrl && (
                  <img src={staffInfo.avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover" />
                )}
                <span className="text-[10px] font-medium" style={{ color: "var(--brand)" }}>{staffInfo.name}</span>
              </div>
            )}
          </div>

          <StepBar step={2} />
        </div>
      </div>

      {/* ── Quick slots for this barber ── */}
      {!loading && quickSlots.length > 0 && (
        <div className="px-4 pt-5 pb-2">
          <div className="flex items-center gap-2 mb-3">
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase" style={{ color: "var(--brand)" }}>
              התורים הכי קרובים
            </p>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {quickSlots.map((slot, i) => (
              <Link key={i}
                href={`/book/confirm?staffId=${slot.staffId}&serviceId=${slot.serviceId}&date=${slot.date}&time=${slot.time}`}
                className="flex-shrink-0 rounded-2xl p-3 active:scale-95 transition-transform"
                style={{
                  background: "var(--card)",
                  border: `1.5px solid var(--brand)`,
                  minWidth: 96,
                }}>
                <p className="text-[16px] font-bold tracking-widest leading-none" dir="ltr"
                  style={{ color: "var(--brand)" }}>{slot.time}</p>
                <p className="text-[10px] mt-1" style={{ color: "var(--text-sec)" }}>{slot.dayLabel}</p>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{slot.duration} דק׳</p>
              </Link>
            ))}
          </div>

          <div className="mt-4 mb-1 flex items-center gap-3">
            <div className="flex-1 h-px" style={{ background: "var(--divider)" }} />
            <span className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "var(--text-muted)" }}>כל השירותים</span>
            <div className="flex-1 h-px" style={{ background: "var(--divider)" }} />
          </div>
        </div>
      )}

      {/* ── Page subtitle ── */}
      {!loading && quickSlots.length === 0 && (
        <div className="px-4 pt-6 pb-3">
          <p className="text-[10px] tracking-[0.3em] uppercase font-medium" style={{ color: "var(--brand)" }}>שירותים</p>
          <h2 className="text-xl font-semibold mt-1" style={{ color: "var(--text-pri)" }}>מה תרצה לעשות?</h2>
        </div>
      )}

      {/* ── Services list ── */}
      <div className="px-4 pt-3 space-y-2.5">
        {loading ? (
          [1, 2, 3].map(i => (
            <div key={i} className="h-[80px] rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
          ))
        ) : (
          services.map(service => {
            const price = service.customPrice ?? service.price;
            const duration = service.customDuration ?? service.durationMinutes;

            return (
              <Link key={service.id}
                href={`/book/time?staffId=${staffId}&serviceId=${service.id}`}
                className="flex items-center rounded-2xl overflow-hidden active:scale-[0.99] transition-all"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--divider)",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
                }}>

                {/* Brand accent bar */}
                <div className="w-1 self-stretch flex-shrink-0" style={{ background: "var(--brand)" }} />

                {/* Content */}
                <div className="flex items-center flex-1 gap-3 px-4 py-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[14px] font-semibold leading-tight" style={{ color: "var(--text-pri)" }}>
                      {service.name}
                    </h3>
                    {service.description && (
                      <p className="text-[11px] mt-1 leading-relaxed line-clamp-2" style={{ color: "var(--text-muted)" }}>
                        {service.description}
                      </p>
                    )}
                    {service.showDuration !== false && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[11px] px-2 py-0.5 rounded-full"
                          style={{ background: "var(--bg-alt)", color: "var(--text-muted)" }}>
                          {duration} דקות
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Price + arrow */}
                  <div className="flex-shrink-0 flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-[22px] font-bold leading-none" style={{ color: "var(--brand)" }}>₪{price}</p>
                    </div>
                    <svg className="w-4 h-4 rotate-180 flex-shrink-0" fill="none" viewBox="0 0 24 24"
                      stroke="currentColor" strokeWidth={2} style={{ color: "var(--text-muted)" }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
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
        <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
          <div className="text-[10px] tracking-[0.3em] uppercase" style={{ color: "var(--text-muted)" }}>טוען...</div>
        </div>
      }
    >
      <ChooseServicePageContent />
    </Suspense>
  );
}
