"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSlug, apiWithSlug, publicHref, useSmartBack } from "@/lib/public-nav";

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
  tagline: string | null;
  avatarUrl: string | null;
  isAvailable: boolean;
};

// ── Compute slot day display label ────────────────────────────────────────────
// Returns "היום" / "מחר" / day-name / "d/M" depending on how far the slot is
function slotDayDisplay(slot: QuickSlot): string {
  if (slot.dayLabel === "היום") return "היום";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const slotDate = new Date(slot.date + "T00:00:00");
  const diffDays = Math.round((slotDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > 7) {
    return `${slotDate.getDate()}/${slotDate.getMonth() + 1}`;
  }
  return slot.dayLabel; // "מחר" / "יום שלישי" etc.
}

// ── Back arrow ─────────────────────────────────────────────────────────────────
function BackArrow({ href }: { href: string }) {
  const onBack = useSmartBack(href);
  return (
    <Link href={href} onClick={onBack}
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
  const slug = useSlug();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [quickSlots, setQuickSlots] = useState<QuickSlot[]>([]);
  // Nearest available slot per barber (covers ALL barbers, not just the quick pool)
  const [nearestByStaff, setNearestByStaff] = useState<Record<string, QuickSlot>>({});
  const [loading, setLoading] = useState(true);
  const [welcomeName, setWelcomeName] = useState("");
  // Returning referrer — thank-you + progress meter ("חבר מביא חבר")
  const [referral, setReferral] = useState<{ name: string; referralCount: number; goal: number; giftLabel: string } | null>(null);
  const [referralPop, setReferralPop] = useState(false); // celebratory modal on a NEW referral

  useEffect(() => {
    Promise.all([
      fetch(apiWithSlug("/api/staff", slug)).then(r => r.json()),
      fetch(apiWithSlug("/api/quick-slots", slug)).then(r => r.json()),
    ])
      .then(([staffData, slots]: [Staff[], QuickSlot[]]) => {
        setStaff(staffData);
        setQuickSlots(slots);
        setLoading(false);

        // Fetch the nearest available slot for EVERY barber (in parallel),
        // so even barbers outside the quick pool show their next opening.
        if (Array.isArray(staffData)) {
          staffData.forEach((member) => {
            fetch(apiWithSlug(`/api/quick-slots?staffId=${member.id}`, slug))
              .then(r => r.ok ? r.json() : [])
              .then((arr: QuickSlot[]) => {
                if (Array.isArray(arr) && arr.length > 0) {
                  setNearestByStaff(prev => ({ ...prev, [member.id]: arr[0] }));
                }
              })
              .catch(() => {});
          });
        }
      })
      .catch(() => setLoading(false));

    // Returning customer — greet by name (saved after first booking)
    try {
      const saved = JSON.parse(localStorage.getItem("bk_customer") || "null");
      if (saved?.name) setWelcomeName(String(saved.name).split(" ")[0]); // first name only
    } catch { /* ignore */ }

    // Returning referrer — thank them + show their progress toward the gift.
    // Identity comes from the httpOnly bk_session cookie (sent automatically).
    fetch(apiWithSlug("/api/customers/referral-status", slug))
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.ok || data.referralCount <= 0) return;
        setReferral({ name: data.name, referralCount: data.referralCount, goal: data.goal, giftLabel: data.giftLabel });
        // "Pop" a celebration only when the count grew since we last showed it,
        // so a returning customer isn't nagged on every visit.
        try {
          const seen = Number(localStorage.getItem("bk_referral_seen") || "0");
          if (data.referralCount > seen) setReferralPop(true);
          localStorage.setItem("bk_referral_seen", String(data.referralCount));
        } catch { /* ignore */ }
      })
      .catch(() => {});
  }, []);

  const getBarberSlot = (staffId: string) =>
    nearestByStaff[staffId] || quickSlots.find(s => s.staffId === staffId);

  // Tapping the referral pill → invite another friend (share sheet / WhatsApp).
  const inviteFriend = async () => {
    const url = window.location.origin + "/";
    const text = `קבעתי כאן תור 💈 ממליץ לך גם! קבע דרך הקישור:`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title: "DOMINANT", text, url }); return; } catch { /* cancelled */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text + " " + url)}`, "_blank");
  };

  return (
    <div className="min-h-screen pb-24" dir="rtl" style={{ background: "var(--bg)" }}>

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-20 px-4 py-3"
        style={{ background: "var(--header-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--divider)" }}>
        <div className="flex items-center justify-between">
          <BackArrow href={publicHref(slug, "/")} />
          <h1 className="text-[13px] font-semibold tracking-[0.15em]" style={{ color: "var(--text-pri)" }}>
            בחירת ספר
          </h1>
          {/* Step indicator intentionally omitted on the barber-selection screen — it's the entry step, no progress to show */}
          <div className="w-9" />
        </div>
      </div>

      {/* ── Welcome back banner (returning customer) ── */}
      {welcomeName && (
        <div className="px-4 pt-4 pb-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xl">👋</span>
              <div className="min-w-0">
                <p className="text-[17px] font-bold leading-tight truncate" style={{ color: "var(--text-pri)" }}>
                  ברוך הבא, {welcomeName}!
                </p>
                <p className="text-[12px] leading-tight mt-0.5" style={{ color: "var(--text-muted)" }}>
                  שמחים לראות אותך שוב — בוא נקבע לך תור
                </p>
              </div>
            </div>
            {/* My Appointments — returning customer shortcut */}
            <Link href={publicHref(slug, "/book/my-appointments")}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full active:scale-95 transition-transform"
              style={{ background: "var(--card)", border: "1px solid var(--divider)", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                style={{ color: "var(--brand)" }}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-[12px] font-bold whitespace-nowrap" style={{ color: "var(--text-pri)" }}>
                התורים שלי
              </span>
            </Link>
          </div>
        </div>
      )}

      {/* ── Referrer progress — compact minimalist pill ── */}
      {referral && (() => {
        const reached = referral.referralCount >= referral.goal;
        const shown = Math.min(referral.referralCount, referral.goal);
        const remaining = Math.max(0, referral.goal - referral.referralCount);
        return (
          <div className="px-4 pt-3 flex justify-center">
            <button onClick={inviteFriend}
              className="w-full max-w-[280px] rounded-2xl px-3.5 py-2.5 shadow-sm text-white text-right active:scale-[0.97] transition-transform"
              style={{ background: "var(--brand)" }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[12px] font-bold">🙌 תודה על ההמלצות!</span>
                <span className="text-[12px] font-extrabold" dir="ltr">{shown}/{referral.goal}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10.5px] text-white/85 leading-snug">
                  {reached
                    ? `הגעת ליעד — מגיעה לך ${referral.giftLabel}! 🎁`
                    : `עוד ${remaining} ${remaining === 1 ? "חבר" : "חברים"} ו${referral.giftLabel} עליך 💈`}
                </p>
                <span className="flex items-center gap-0.5 text-[10.5px] font-bold text-white whitespace-nowrap flex-shrink-0">
                  הזמינו חבר
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </span>
              </div>
            </button>
          </div>
        );
      })()}

      {/* ── New-referral celebration modal ── */}
      {referralPop && referral && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
          onClick={() => setReferralPop(false)}>
          <div className="w-full max-w-xs rounded-3xl p-6 text-center shadow-2xl"
            style={{ background: "var(--card)" }}
            onClick={e => e.stopPropagation()}>
            <div className="text-5xl mb-2">🎉</div>
            <p className="text-[18px] font-bold" style={{ color: "var(--text-pri)" }}>
              תודה, {referral.name.split(" ")[0]}!
            </p>
            <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: "var(--text-sec)" }}>
              {referral.referralCount >= referral.goal
                ? `הבאת ${referral.referralCount} חברים — מגיעה לך ${referral.giftLabel}! דבר איתנו 💈`
                : `חבר נוסף שהמלצת עליו קבע תור! כבר הבאת ${referral.referralCount} מתוך ${referral.goal} ל${referral.giftLabel} 🎁`}
            </p>
            <button onClick={() => setReferralPop(false)}
              className="mt-5 w-full py-3 rounded-full text-[13px] font-bold text-white"
              style={{ background: "var(--brand)" }}>
              מגניב! ✨
            </button>
          </div>
        </div>
      )}

      {/* ── Quick slots strip ── */}
      {!loading && quickSlots.length > 0 && (
        <div className="px-4 pt-5 pb-1">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
              </span>
              <p className="text-[11px] font-semibold tracking-[0.2em] uppercase" style={{ color: "var(--brand)" }}>
                התורים הקרובים
              </p>
            </div>
            <Link
              href={publicHref(slug, "/book/team-upcoming")}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 active:scale-95 transition-transform"
              style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)" }}>
              <span className="text-[11px] font-semibold" style={{ color: "var(--text-sec)" }}>כל התורים</span>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}
                style={{ color: "var(--text-sec)" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {quickSlots.map((slot, i) => (
              <Link key={i}
                href={publicHref(slug, `/book/confirm?staffId=${slot.staffId}&serviceId=${slot.serviceId}&date=${slot.date}&time=${slot.time}`)}
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

      {/* ── Staff grid — compact, fits all on screen ── */}
      <div className="px-3 pt-3 grid grid-cols-3 gap-2.5 pb-6">
        {loading ? (
          [1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="animate-pulse" style={{ borderRadius: 28, aspectRatio: "3/4", background: "var(--card)" }} />
          ))
        ) : (
          staff.map(member => {
            const slot = getBarberSlot(member.id);
            const hasToday = slot?.dayLabel === "היום";

            return (
              <div key={member.id} className="relative overflow-hidden active:scale-[0.96] transition-transform"
                style={{ borderRadius: 28, aspectRatio: "3/4", background: "var(--bg-alt)", boxShadow: "0 3px 12px rgba(0,0,0,0.1)" }}>

                {/* Photo */}
                <Link href={publicHref(slug, `/book/service?staffId=${member.id}`)} className="absolute inset-0">
                  {member.avatarUrl ? (
                    <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl font-bold"
                      style={{ color: "var(--text-muted)" }}>
                      {member.name[0]}
                    </div>
                  )}
                  <div className="absolute inset-0"
                    style={{ background: "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.1) 55%, transparent 100%)" }} />
                </Link>

                {/* Live dot */}
                {hasToday && (
                  <span className="absolute top-2 left-2 flex h-2 w-2 z-10">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                )}

                {/* Name */}
                <Link href={publicHref(slug, `/book/service?staffId=${member.id}`)}
                  className="absolute inset-x-0 z-10 px-2 text-center"
                  style={{ bottom: slot ? 38 : 10 }}>
                  <p className="font-bold text-[11px] text-white leading-tight truncate"
                    style={{ textShadow: "0 2px 6px rgba(0,0,0,0.85), 0 1px 2px rgba(0,0,0,0.9)" }}>{member.name}</p>
                  {member.tagline && (
                    <p className="text-[10px] text-white/85 leading-tight truncate mt-0.5"
                      style={{ textShadow: "0 1px 4px rgba(0,0,0,0.85)" }}>{member.tagline}</p>
                  )}
                </Link>

                {/* Slot / CTA */}
                {slot ? (
                  <Link
                    href={publicHref(slug, `/book/confirm?staffId=${slot.staffId}&serviceId=${slot.serviceId}&date=${slot.date}&time=${slot.time}`)}
                    className="absolute bottom-1.5 inset-x-2 z-10 flex flex-col items-center justify-center py-0.5 active:opacity-80 transition-opacity"
                    style={{ background: "var(--brand)", borderRadius: 10 }}>
                    <span className="text-[7px] font-medium text-white/75 leading-none mb-0.5">
                      התור הקרוב{slotDayDisplay(slot) ? ` · ${slotDayDisplay(slot)}` : ""}
                    </span>
                    <span className="text-[10px] font-bold text-white leading-none">{slot.time}</span>
                  </Link>
                ) : (
                  <Link
                    href={publicHref(slug, `/book/service?staffId=${member.id}`)}
                    className="absolute bottom-2 inset-x-2 z-10 flex items-center justify-center py-1.5 active:opacity-80"
                    style={{ background: "rgba(255,255,255,0.14)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 14 }}>
                    <span className="text-[10px] font-semibold text-white">קבע תור</span>
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
