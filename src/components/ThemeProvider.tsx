"use client";

import { createContext, useContext } from "react";
import { THEMES, type Theme } from "@/lib/themes";

// Holds the server-resolved theme so client pages can use it as their INITIAL
// value (instead of hardcoding THEMES.onyx) — killing the theme flash on load.
const ThemeContext = createContext<Theme>(THEMES.onyx);

export function ThemeProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** Read the server-resolved theme. Safe to call during SSR and on the client. */
export function useServerTheme(): Theme {
  return useContext(ThemeContext);
}
