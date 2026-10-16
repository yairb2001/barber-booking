"use client";

import { createContext, useContext, useMemo } from "react";
import { vocabFor, type Vocab, type BookingOrder, type StaffChoice } from "@/lib/vocab";

// Holds the server-resolved business vocabulary (ספר / ספרית / מניקוריסטית…)
// so the customer-facing screens use the right words from the first paint —
// same idea as ThemeProvider. Default: barber_men (DOMINANT's wording).
// Also the booking order (16.10.2026): treatment first or staff first.
const VocabContext = createContext<Vocab>(vocabFor("barber_men"));
const OrderContext = createContext<BookingOrder>("staff");
const ChoiceContext = createContext<StaffChoice>("customer");

export function VocabProvider({ type, vocab: overrides, order = "staff", staffChoice = "customer", children }: { type: string | null | undefined; vocab?: Record<string, unknown> | null; order?: BookingOrder; staffChoice?: StaffChoice; children: React.ReactNode }) {
  const vocab = useMemo(() => vocabFor(type, overrides ?? null), [type, overrides]);
  return <VocabContext.Provider value={vocab}><OrderContext.Provider value={order}><ChoiceContext.Provider value={staffChoice}>{children}</ChoiceContext.Provider></OrderContext.Provider></VocabContext.Provider>;
}

/** "customer": the customer picks who; "least" / "most": the system assigns, she only picks the treatment and the time. */
export function useStaffChoice(): StaffChoice {
  return useContext(ChoiceContext);
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
