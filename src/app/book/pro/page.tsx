"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSlug, apiWithSlug, publicHref, useSmartBack } from "@/lib/public-nav";
import { useVocab, useStaffChoice } from "@/components/VocabProvider";
import { priceLabel } from "@/components/booking/TreatmentList";

/**
 * Treatment first, step 2 (16.10.2026): who does the chosen treatment. Only
 * the people who do it are shown, each with her own price and duration; "any"
 * finds the nearest time across all of them. With one person the step skips
 * itself, as on the leading booking sites.
 */
type Pro = { id: string; name: string; tagline: string | null; avatarUrl: string | null; servicePrice: number; serviceDuration: number };
type Treatment = { id: string; name: string; priceMin: number; priceMax: number };

function BackArrow({ href }: { href: string }) {
  const onBack = useSmartBack(href);
  return (
    <Link href={href} onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full" style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)" }} aria-label="חזרה">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "var(--text-sec)" }}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
    </Link>
  );
}

function ProContent() {
  const slug = useSlug();
  const v = useVocab();
  const router = useRouter();
  const serviceId = useSearchParams().get("serviceId") || "";
  const auto = useStaffChoice() !== "customer";
  const [pros, setPros] = useState<Pro[] | null>(null);
  const [treatment, setTreatment] = useState<Treatment | null>(null);

  useEffect(() => {
    if (!serviceId) return;
    // The system assigns who (settings): no choosing here, straight to the times.
    if (auto) { router.replace(publicHref(slug, `/book/team-date?serviceId=${serviceId}`)); return; }
    Promise.all([
      fetch(apiWithSlug(`/api/staff?serviceId=${encodeURIComponent(serviceId)}`, slug)).then(r => (r.ok ? r.json() : [])),
      fetch(apiWithSlug("/api/services?offered=1", slug)).then(r => (r.ok ? r.json() : [])),
    ]).then(([staff, services]: [Pro[], Treatment[]]) => {
      const list = Array.isArray(staff) ? staff : [];
      setTreatment((Array.isArray(services) ? services : []).find(s => s.id === serviceId) ?? null);
      // Only one person does it: straight to her times.
      if (list.length === 1) { router.replace(publicHref(slug, `/book/time?staffId=${list[0].id}&serviceId=${serviceId}`)); return; }
      setPros(list);
    }).catch(() => setPros([]));
  }, [serviceId, slug, router, auto]);

  return (
    <div className="min-h-screen pb-24" dir="rtl" style={{ background: "var(--bg)" }}>
      <div className="sticky top-0 z-20 px-4 py-3" style={{ background: "var(--header-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--divider)" }}>
        <div className="flex items-center justify-between">
          <BackArrow href={publicHref(slug, "/book")} />
          <div className="flex flex-col items-center gap-0.5 min-w-0">
            <h1 className="text-[13px] font-semibold tracking-[0.12em]" style={{ color: "var(--text-pri)" }}>אצל מי?</h1>
            {treatment && <span className="text-[11px] font-medium truncate max-w-[60vw]" style={{ color: "var(--brand)" }}>{treatment.name}</span>}
          </div>
          <span className="w-9" />
        </div>
      </div>

      <div className="px-4 pt-6 pb-3">
        <h2 className="text-xl font-semibold" style={{ color: "var(--text-pri)" }}>{v.choose} {v.staff}</h2>
      </div>

      <div className="px-4 space-y-2.5">
        {pros === null ? (
          [1, 2, 3].map(i => <div key={i} className="h-[72px] rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />)
        ) : pros.length === 0 ? (
          <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>כרגע אין מי שמבצע את הטיפול הזה.</p>
        ) : (
          <>
            {/* Any of them: the nearest time across everyone who does it. */}
            <Link href={publicHref(slug, `/book/team-date?serviceId=${serviceId}`)}
              className="flex items-center gap-3 rounded-2xl px-4 py-3.5 active:scale-[0.99] transition-all"
              style={{ background: "var(--card)", border: "1.5px solid var(--brand)" }}>
              <span className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0" style={{ background: "var(--bg-alt)", color: "var(--brand)" }}>✦</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-semibold" style={{ color: "var(--text-pri)" }}>לא משנה לי</span>
                <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>התור הכי קרוב אצל כל {v.staffPluralDef}{treatment && treatment.priceMin < treatment.priceMax ? `, ${priceLabel(treatment.priceMin, treatment.priceMax)}` : ""}</span>
              </span>
            </Link>
            {pros.map(p => (
              <Link key={p.id} href={publicHref(slug, `/book/time?staffId=${p.id}&serviceId=${serviceId}`)}
                className="flex items-center gap-3 rounded-2xl px-4 py-3 active:scale-[0.99] transition-all"
                style={{ background: "var(--card)", border: "1px solid var(--divider)", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                {p.avatarUrl
                  ? <img src={p.avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                  : <span className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0" style={{ background: "var(--bg-alt)", color: "var(--text-muted)" }}>{p.name.trim().charAt(0)}</span>}
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold truncate" style={{ color: "var(--text-pri)" }}>{p.name}</span>
                  {p.tagline && <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{p.tagline}</span>}
                  <span className="block text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{p.serviceDuration} דקות</span>
                </span>
                <span className="text-[18px] font-bold flex-shrink-0" style={{ color: "var(--brand)" }}>₪{p.servicePrice}</span>
              </Link>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default function ChooseProPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: "var(--bg)" }} />}>
      <ProContent />
    </Suspense>
  );
}
