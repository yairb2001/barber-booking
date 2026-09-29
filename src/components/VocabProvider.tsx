"use client";

import { createContext, useContext, useMemo } from "react";
import { vocabFor, type Vocab } from "@/lib/vocab";

// Holds the server-resolved business vocabulary (ספר / ספרית / מניקוריסטית…)
// so the customer-facing screens use the right words from the first paint —
// same idea as ThemeProvider. Default: barber_men (DOMINANT's wording).
const VocabContext = createContext<Vocab>(vocabFor("barber_men"));

export function VocabProvider({ type, children }: { type: string | null | undefined; children: React.ReactNode }) {
  const vocab = useMemo(() => vocabFor(type), [type]);
  return <VocabContext.Provider value={vocab}>{children}</VocabContext.Provider>;
}

/** The current business's vocabulary. Safe during SSR and on the client. */
export function useVocab(): Vocab {
  return useContext(VocabContext);
}
