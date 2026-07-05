"use client";

import { useEffect, useRef } from "react";

/**
 * Makes the browser / OS "back" action close an open overlay (modal, drawer,
 * quick-action sheet) instead of navigating away from the current page.
 *
 * Why this exists
 * ---------------
 * Admin overlays are rendered from React state, not from the URL. On mobile —
 * and especially inside the native iOS/Android shell — pressing the hardware
 * back button (or the iOS swipe-back gesture) triggers a real history "back".
 * Because the open overlay never pushed a history entry, that back press pops
 * the *page* the user was on and dumps them somewhere else (usually the
 * calendar). The user experiences this as "it doesn't return me to the screen
 * I came from".
 *
 * How it works
 * ------------
 * While `open` is true we push one throwaway history entry tagged with a unique
 * id. A back gesture pops it and fires `popstate`, which we translate into
 * `onClose()` — so the FIRST back closes the overlay and keeps the user exactly
 * where they were, and the SECOND back travels to the previous page (the normal
 * <Link> history). Closing the overlay through its own UI (the ✕ / cancel
 * button) removes the sentinel entry we added so the history stack stays clean.
 *
 * Nesting is supported: each overlay owns its own tagged entry, so an inner
 * overlay closes first, then the outer one, then the page — in the order the
 * user opened them.
 *
 * Usage: call once, unconditionally, near the top of an overlay component:
 *   useModalBack(true, onClose);           // component is mounted only while open
 *   useModalBack(isOpen, () => setOpen(false));  // component stays mounted
 */
export function useModalBack(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    const id = Math.random().toString(36).slice(2);
    window.history.pushState({ __modal: id }, "");
    // Set when a back gesture (not the overlay's own UI) closed us, so cleanup
    // knows the sentinel entry is already gone and must not be popped again.
    let closedByBack = false;

    const onPop = () => {
      const state = window.history.state as { __modal?: string } | null;
      // Ignore pops that landed us back ON our own entry — that means an INNER
      // overlay was dismissed and ours is still the active one.
      if (state?.__modal === id) return;
      closedByBack = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      // Overlay closed via its own UI while our sentinel is still the current
      // top entry → pop it so history doesn't accumulate a dead state and the
      // next back press lands on the real previous page. Skip if the back
      // gesture already popped it, or if the user navigated away via a link
      // (our entry is no longer on top).
      const state = window.history.state as { __modal?: string } | null;
      if (!closedByBack && state?.__modal === id) {
        window.history.back();
      }
    };
  }, [open]);
}
