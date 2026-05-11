// ─── ThemeProvider — dynamic per-business branding ───────────────────────────
// Wrap each business subtree with this provider.
// Components call useTheme() to get brand colors without hardcoding anything.

import React, { createContext, useContext, useState } from "react";
import type { AppTheme } from "@/lib/theme";
import { THEMES, DEFAULT_THEME_ID } from "@/lib/theme";

type ThemeContextValue = {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: THEMES[DEFAULT_THEME_ID],
  setTheme: () => {},
});

export function ThemeProvider({
  children,
  initialTheme,
}: {
  children: React.ReactNode;
  initialTheme?: AppTheme;
}) {
  const [theme, setTheme] = useState<AppTheme>(
    initialTheme ?? THEMES[DEFAULT_THEME_ID]
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Hook — access current business theme anywhere in the tree */
export function useTheme(): AppTheme {
  return useContext(ThemeContext).theme;
}

/** Hook — also get the setter (only needed in layout loaders) */
export function useThemeContext(): ThemeContextValue {
  return useContext(ThemeContext);
}
