"use client";

import { createContext, useEffect } from "react";
import { useRouter } from "next/navigation";
import { C } from "./ui";

/**
 * A lead or customer card opened from inside the CRM shows as a large sheet
 * over the current screen (10.10.2026, Yair: "כמו כרטיס קופץ גדול כמעט על כל
 * המסך, במקום לפתוח את הכל כמו טאב חדש"). Closing returns to exactly where
 * you were. A direct link (a push, a shared URL) still opens the full page.
 */
export const InModal = createContext(false);

export function CardModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") router.back(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [router]);
  return (
    <div className="fixed inset-0 z-50 font-heebo" dir="rtl" role="dialog" aria-modal="true">
      {/* A bit smaller than the screen, the screen behind it blurred, a soft shadow (Yair, 10.10.2026). */}
      <div className="absolute inset-0 backdrop-blur-[3px]" style={{ background: "rgba(11,31,33,0.28)" }} onClick={() => router.back()} />
      <div className="absolute inset-x-4 top-14 bottom-6 md:inset-x-0 md:mx-auto md:w-[min(880px,88%)] md:top-[7%] md:bottom-[7%] rounded-[20px] overflow-hidden flex flex-col" style={{ background: C.ground, color: C.ink, boxShadow: "0 18px 50px rgba(11,31,33,0.28), 0 3px 10px rgba(11,31,33,0.12)" }}>
        <div className="flex items-center justify-between px-3 py-2 shrink-0" style={{ background: "#fff", borderBottom: `1px solid ${C.line}` }}>
          <button type="button" onClick={() => router.back()} className="w-10 h-10 rounded-full inline-flex items-center justify-center" style={{ color: C.petrol }} aria-label="סגור">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <span className="w-10" />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-8 md:py-6">
          <InModal.Provider value={true}>{children}</InModal.Provider>
        </div>
      </div>
    </div>
  );
}
