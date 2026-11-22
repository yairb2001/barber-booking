"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NoticePopup, useBookingNotices, generalKey, staffKey, seen, markSeen, type NoticeItem } from "@/components/BookingNotice";
import { useSlug, apiWithSlug, publicHref, useSmartBack } from "@/lib/public-nav";
import { useVocab, useBookingOrder, useG } from "@/components/VocabProvider";
import TreatmentList from "@/components/booking/TreatmentList";
import { AnyStaffPill, StaffCircleGrid } from "@/components/booking/StaffCircles";

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
  const v = useVocab();
  const g = useG();
  // Treatment first (16.10.2026): the treatments replace the staff grid and the quick slots.
  const serviceFirst = useBookingOrder() === "service";
  const [staff, setStaff] = useState<Staff[]>([]);
  const [quickSlots, setQuickSlots] = useState<QuickSlot[]>([]);
  // Nearest available slot per barber (covers ALL barbers, not just the quick pool)
  const [nearestByStaff, setNearestByStaff] = useState<Record<string, QuickSlot>>({});
  // Barbers whose nearest-slot lookup finished (so "no slots" is real, not loading)
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [welcomeName, setWelcomeName] = useState("");
  // Returning referrer — thank-you + progress meter ("חבר מביא חבר")
  const [referral, setReferral] = useState<{ name: string; referralCount: number; goal: number; giftLabel: string } | null>(null);
  const [referralPop, setReferralPop] = useState(false); // celebratory modal on a NEW referral
  // "הודעה חשובה" (11.10.2026): the shop's general notice on arrival, and a
  // barber's own when the customer picks him (any link that carries his staffId).
  const router = useRouter();
  const notices = useBookingNotices(slug);
  const [notice, setNotice] = useState<{ items: NoticeItem[]; href?: string } | null>(null);
  useEffect(() => {
    if (notices?.general && !seen(generalKey(notices.general))) setNotice({ items: [{ key: generalKey(notices.general), title: `הודעה מ${v.placeDef}`, text: notices.general }] });
  }, [notices]);
  const onPick = (e: React.MouseEvent) => {
    if (!notices || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a) return;
    const u = new URL(a.href, window.location.href);
    const id = u.searchParams.get("staffId");
    const text = id ? notices.staff[id] : undefined;
    if (!id || !text || seen(staffKey(id, text))) return;
    e.preventDefault();
    e.stopPropagation();
    const m = staff.find(s => s.id === id);
    setNotice({ items: [{ key: staffKey(id, text), title: m ? `הודעה מ${m.name}` : "הודעה חשובה", text, avatarUrl: m?.avatarUrl }], href: u.pathname + u.search });
  };

  useEffect(() => {
    Promise.all([
      fetch(apiWithSlug("/api/staff", slug)).then(r => r.json()),
      serviceFirst ? Promise.resolve([]) : fetch(apiWithSlug("/api/quick-slots", slug)).then(r => r.json()),
    ])
      .then(([staffData, slots]: [Staff[], QuickSlot[]]) => {
        setStaff(staffData);
        setQuickSlots(slots);
        setLoading(false);

        // Fetch the nearest available slot for EVERY barber (in parallel),
        // so even barbers outside the quick pool show their next opening.
        if (Array.isArray(staffData) && !serviceFirst) {
          staffData.forEach((member) => {
            fetch(apiWithSlug(`/api/quick-slots?staffId=${member.id}`, slug))
              .then(r => r.ok ? r.json() : [])
              .then((arr: QuickSlot[]) => {
                if (Array.isArray(arr) && arr.length > 0) {
                  setNearestByStaff(prev => ({ ...prev, [member.id]: arr[0] }));
                }
              })
              .catch(() => {})
              .finally(() => setChecked(prev => new Set(prev).add(member.id)));
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
    // This business's home page, not the root's (a slugged shop used to share DOMINANT's).
    const url = window.location.origin + publicHref(slug, "/");
    const text = `קבעתי כאן תור ${v.emoji} ${g("ממליץ לך גם! קבע דרך הקישור:", "ממליצה לך גם! אפשר לקבוע דרך הקישור:")}`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ text, url }); return; } catch { /* cancelled */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text + " " + url)}`, "_blank");
  };

  return (
    <div className="min-h-screen pb-24" dir="rtl" style={{ background: "var(--bg)" }} onClickCapture={onPick}>
      {notice && <NoticePopup items={notice.items} cta={notice.href ? "הבנתי, ממשיכים" : "הבנתי"} onDone={() => { markSeen(notice.items.map(i => i.key)); const h = notice.href; setNotice(null); if (h) router.push(h); }} />}

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-20 px-4 py-3"
        style={{ background: "var(--header-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--divider)" }}>
        <div className="flex items-center justify-between">
          <BackArrow href={publicHref(slug, "/")} />
          <h1 className="text-[13px] font-semibold tracking-[0.15em]" style={{ color: "var(--text-pri)" }}>
            {serviceFirst ? "קביעת תור" : `בחירת ${v.staff}`}
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
                    : `עוד ${remaining} ${remaining === 1 ? g("חבר", "חברה") : g("חברים", "חברות")} ו${referral.giftLabel} מאיתנו ${v.emoji}`}
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
                ? `הבאת ${referral.referralCount} ${g("חברים", "חברות")} — מגיעה לך ${referral.giftLabel}! ${g("דבר", "דברי")} איתנו ${v.emoji}`
                : `${g("חבר נוסף שהמלצת עליו קבע", "חברה נוספת שהמלצת עליה קבעה")} תור! כבר הבאת ${referral.referralCount} מתוך ${referral.goal} ל${referral.giftLabel} 🎁`}
            </p>
            <button onClick={() => setReferralPop(false)}
              className="mt-5 w-full py-3 rounded-full text-[13px] font-bold text-white"
              style={{ background: "var(--brand)" }}>
              מגניב! ✨
            </button>
          </div>
        </div>
      )}

      {serviceFirst && (
        <div className="px-4 pt-6 pb-6">
          <h2 className="text-xl font-semibold mb-3" style={{ color: "var(--text-pri)" }}>{v.choose} טיפול</h2>
          <TreatmentList />
        </div>
      )}

      {/* ── Choose barber: "any" pill + circles (22.11.2026): big circles, 9 fit the first screen ── */}
      {!serviceFirst && (
        <div className="px-4 pt-3 pb-6 flex flex-col gap-4 w-full max-w-xl mx-auto">
          {!loading && <AnyStaffPill slug={slug} staff={staff} />}
          <StaffCircleGrid slug={slug} staff={staff} loading={loading} slotOf={getBarberSlot} checked={checked} dayText={slotDayDisplay} />
        </div>
      )}
    </div>
  );
}
