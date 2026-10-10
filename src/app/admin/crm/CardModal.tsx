"use client";

import { Suspense, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { C } from "./ui";
import { InModal } from "./card-context";
import LeadCard from "./leads/[id]/LeadCard";
import CustomerCard from "./customers/[id]/CustomerCard";
import ChatThread from "./chats/ChatThread";

/**
 * A lead card, customer card or chat opened from inside the CRM shows as a
 * sheet over the current screen (10.10.2026, Yair: "כמו כרטיס קופץ גדול כמעט
 * על כל המסך, במקום לפתוח את הכל כמו טאב חדש"). Closing returns to exactly
 * where you were. A direct link (a push, a shared URL) still opens the full page.
 *
 * The open card lives in the URL (?card=lead:<id>), not in Next's intercepted
 * routes: those crashed every screen change on the live site in Safari
 * ("undefined is not an object (evaluating '[u,a]')", 10.10.2026).
 */
const CARD_RE = /^\/admin\/crm\/(leads|customers|chats)\/([0-9a-f-]{36})\/?$/i;
const KIND: Record<string, string> = { leads: "lead", customers: "customer", chats: "chat" };
const PUSHED = "crm-card-pushed";

function urlWith(card: string | null): string {
  const p = new URLSearchParams(window.location.search);
  if (card) p.set("card", card); else p.delete("card");
  const q = p.toString();
  return `${window.location.pathname}${q ? `?${q}` : ""}`;
}

export function CardModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 font-heebo" dir="rtl" role="dialog" aria-modal="true">
      {/* A bit smaller than the screen, the screen behind it blurred, a soft shadow (Yair, 10.10.2026). */}
      <div className="absolute inset-0 backdrop-blur-[3px]" style={{ background: "rgba(11,31,33,0.28)" }} onClick={onClose} />
      <div className="absolute inset-x-4 top-14 bottom-6 md:inset-x-0 md:mx-auto md:w-[min(880px,88%)] md:top-[7%] md:bottom-[7%] rounded-[20px] overflow-hidden flex flex-col" style={{ background: C.ground, color: C.ink, boxShadow: "0 18px 50px rgba(11,31,33,0.28), 0 3px 10px rgba(11,31,33,0.12)" }}>
        <div className="flex items-center justify-between px-3 py-2 shrink-0" style={{ background: "#fff", borderBottom: `1px solid ${C.line}` }}>
          <button type="button" onClick={onClose} className="w-10 h-10 rounded-full inline-flex items-center justify-center" style={{ color: C.petrol }} aria-label="סגור">
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

function Host() {
  const router = useRouter();
  const card = useSearchParams().get("card");

  // Opening pushed one history step: closing goes back to it. A card reached
  // any other way (a reload with ?card=…) closes by dropping the parameter.
  const close = useCallback(() => {
    let pushed = false;
    try { pushed = sessionStorage.getItem(PUSHED) === urlWith(new URLSearchParams(window.location.search).get("card")); sessionStorage.removeItem(PUSHED); } catch { /* private mode */ }
    if (pushed) router.back(); else router.replace(urlWith(null), { scroll: false });
  }, [router]);

  // Any plain tap on a link to a card, anywhere in the CRM (lists, home, inside
  // another card), opens it as a sheet. A full card page navigates as usual.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const u = new URL(a.href, window.location.href);
      const m = u.origin === window.location.origin ? CARD_RE.exec(u.pathname) : null;
      if (!m || CARD_RE.test(window.location.pathname)) return;
      e.preventDefault();
      e.stopPropagation();
      const next = urlWith(`${KIND[m[1].toLowerCase()]}:${m[2]}`);
      if (new URLSearchParams(window.location.search).get("card")) {
        // Card to card (sale ↔ customer ↔ chat): swap in place, one step back still closes.
        try { if (sessionStorage.getItem(PUSHED)) sessionStorage.setItem(PUSHED, next); } catch { /* private mode */ }
        router.replace(next, { scroll: false });
      } else {
        try { sessionStorage.setItem(PUSHED, next); } catch { /* private mode */ }
        router.push(next, { scroll: false });
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  const [kind, id] = card ? card.split(":") : [];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const body = kind === "lead" ? <LeadCard id={id} /> : kind === "customer" ? <CustomerCard id={id} /> : kind === "chat" ? <ChatThread id={id} /> : null;
  return body ? <CardModal key={card} onClose={close}>{body}</CardModal> : null;
}

/** Mounted once in the CRM shell. */
export function CardHost() {
  return <Suspense fallback={null}><Host /></Suspense>;
}
