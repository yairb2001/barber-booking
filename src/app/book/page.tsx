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

// ── Back arrow ─────────────────────────────────────────────────────────────────
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

export default function ChooseBarberPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [quickSlots, setQuickSlots] = useState<QuickSlot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/staff").then(r => r.json()),
      fetch("/api/quick-slots").then(r => r.json()),
    ])
      .then(([staffData, slots]) => {
        setStaff(staffData);
        setQuickSlots(slots);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const getBarberSlot = (staffId: string) => quickSlots.find(s => s.staffId === staffId);

  return (
    <div className="min-h-screen pb-24" dir="rtl" style={{ background: "var(--bg)" }}>

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-20 px-4 py-3"
        style={{ background: "var(--header-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--divider)" }}>
        <div className="flex items-center justify-between">
          <BackArrow href="/" />
          <h1 className="text-[13px] font-semibold tracking-[0.15em]" style={{ color: "var(--text-pri)" }}>
            בחירת ספר
          </h1>
          <StepBar step={1} />
        </div>
      </div>

      {/* ── Quick slots strip ── */}
      {!loading && quickSlots.length > 0 && (
        <div className="px-4 pt-5 pb-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase" style={{ color: "var(--brand)" }}>
              התורים הקרובים
            </p>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {quickSlots.map((slot, i) => (
              <Link key={i}
                href={`/book/confirm?staffId=${slot.staffId}&serviceId=${slot.serviceId}&date=${slot.date}&time=${slot.time}`}
                className="flex-shrink-0 rounded-2xl p-3 active:scale-95 transition-transform"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--divider)",
                  minWidth: 100,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                }}>
                <p className="text-[16px] font-bold tracking-widest leading-none" dir="ltr"
                  style={{ color: "var(--brand)" }}>{slot.time}</p>
                <p className="text-[10px] mt-1" style={{ color: "var(--text-sec)" }}>{slot.dayLabel}</p>
                <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>{slot.staffName}</p>
              </Link>
            ))}
          </div>

          {/* Divider */}
          <div className="mt-5 mb-1 flex items-center gap-3">
            <div className="flex-1 h-px" style={{ background: "var(--divider)" }} />
            <span className="text-[9px] tracking-[0.3em] uppercase" style={{ color: "#CBD5E1" }}>או בחר ספר</span>
            <div className="flex-1 h-px" style={{ background: "var(--divider)" }} />
          </div>
        </div>
      )}

      {/* ── Page title ── */}
      {!loading && quickSlots.length === 0 && (
        <div className="px-4 pt-6 pb-2">
          <p className="text-[10px] tracking-[0.3em] uppercase font-medium" style={{ color: "var(--brand)" }}>הצוות שלנו</p>
          <h2 className="text-xl font-semibold mt-1" style={{ color: "var(--text-pri)" }}>בחר את הספר שלך</h2>
        </div>
      )}

      {/* ── Staff grid — 2-column rounded squares ── */}
      <div className="px-4 pt-4 grid grid-cols-2 gap-3">
        {loading ? (
          [1, 2, 3, 4].map(i => (
            <div key={i} className="rounded-3xl animate-pulse" style={{ aspectRatio: "3/4", background: "var(--card)" }} />
          ))
        ) : (
          staff.map(member => {
            const slot = getBarberSlot(member.id);
            const hasToday = slot?.dayLabel === "היום";

            return (
              <div key={member.id} className="relative rounded-3xl overflow-hidden active:scale-[0.97] transition-transform"
                style={{ aspectRatio: "3/4", background: "var(--bg-alt)", boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}>

                {/* Photo — full card */}
                <Link href={`/book/service?staffId=${member.id}`} className="absolute inset-0">
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-5xl font-bold"
                      style={{ color: "var(--text-muted)" }}>
                      {member.name[0]}
                    </div>
                  )}
                  {/* Bottom gradient */}
                  <div className="absolute inset-0"
                    style={{ background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.18) 50%, transparent 100%)" }} />
                </Link>

                {/* Live dot top-left */}
                {hasToday && (
                  <span className="absolute top-3 left-3 flex h-2.5 w-2.5 z-10">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                  </span>
                )}

                {/* Name — bottom overlay */}
                <Link href={`/book/service?staffId=${member.id}`}
                  className="absolute bottom-0 inset-x-0 px-3 z-10"
                  style={{ paddingBottom: slot ? "52px" : "14px" }}>
                  <p className="font-bold text-[14px] text-white leading-tight truncate">{member.name}</p>
                  {member.nickname && (
                    <p className="text-[10px] text-white/60 truncate">{member.nickname}</p>
                  )}
                </Link>

                {/* Slot button — direct book */}
                {slot ? (
                  <Link
                    href={`/book/confirm?staffId=${slot.staffId}&serviceId=${slot.serviceId}&date=${slot.date}&time=${slot.time}`}
                    className="absolute bottom-3 inset-x-3 z-10 flex items-center justify-center gap-1.5 py-2 rounded-2xl active:opacity-80 transition-opacity"
                    style={{ background: "var(--brand)" }}>
                    <span className="text-[13px] font-bold text-white tracking-widest" dir="ltr">{slot.time}</span>
                    <span className="text-[10px] text-white/80">⚡ {slot.dayLabel}</span>
                  </Link>
                ) : (
                  <Link
                    href={`/book/service?staffId=${member.id}`}
                    className="absolute bottom-3 inset-x-3 z-10 flex items-center justify-center py-2 rounded-2xl active:opacity-80 transition-opacity"
                    style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.25)" }}>
                    <span className="text-[11px] font-semibold text-white">קבע תור</span>
                  </Link>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
