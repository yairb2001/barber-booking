"use client";

import { createContext, useContext, useMemo } from "react";
import { vocabFor, type Vocab, type BookingOrder } from "@/lib/vocab";

// Holds the server-resolved business vocabulary (ספר / ספרית / מניקוריסטית…)
// so the customer-facing screens use the right words from the first paint —
// same idea as ThemeProvider. Default: barber_men (DOMINANT's wording).
// Also the booking order (16.10.2026): treatment first or staff first.
const VocabContext = createContext<Vocab>(vocabFor("barber_men"));
const OrderContext = createContext<BookingOrder>("staff");

export function VocabProvider({ type, vocab: overrides, order = "staff", children }: { type: string | null | undefined; vocab?: Record<string, string> | null; order?: BookingOrder; children: React.ReactNode }) {
  const vocab = useMemo(() => vocabFor(type, overrides ?? null), [type, overrides]);
  return <VocabContext.Provider value={vocab}><OrderContext.Provider value={order}>{children}</OrderContext.Provider></VocabContext.Provider>;
}

/** The current business's vocabulary. Safe during SSR and on the client. */
export function useVocab(): Vocab {
  return useContext(VocabContext);
}

/** "service": treatment first, then who does it; "staff": the barber first. */
export function useBookingOrder(): BookingOrder {
  return useContext(OrderContext);
}

/** Addressing the customer: g("בחר", "בחרי") — feminine where the business's
 *  customers are women (salon, nails, cosmetics); DOMINANT keeps the masculine. */
export function useG(): (m: string, f: string) => string {
  const fem = useContext(VocabContext).customerFem;
  return (m, f) => (fem ? f : m);
}
