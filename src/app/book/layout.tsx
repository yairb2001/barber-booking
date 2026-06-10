"use client";

import { useEffect, useState } from "react";
import FooterCTA from "@/components/FooterCTA";
import { type Theme } from "@/lib/themes";
import { useServerTheme } from "@/components/ThemeProvider";
import { useSlug, apiWithSlug } from "@/lib/public-nav";

export default function BookLayout({ children }: { children: React.ReactNode }) {
  // Start from the server-resolved theme so the first paint is correct
  // (no flash of the default gold theme before the client fetch resolves).
  const slug = useSlug();
  const serverTheme = useServerTheme();
  const [theme, setTheme] = useState<Theme>(serverTheme);

  useEffect(() => {
    fetch(apiWithSlug("/api/business", slug))
      .then(r => r.json())
      .then(biz => { if (biz?.theme) setTheme(biz.theme); })
      .catch(() => {});
  }, []);

  // Honor the full theme palette so the booking flow background shifts per
  // preset (not just the buttons). All presets use light, readable surfaces.
  const cssVars = `
    :root {
      --brand:       ${theme.brand};
      --brand-soft:  ${theme.brandSoft};
      --bg:          ${theme.bg};
      --bg-alt:      ${theme.bgAlt};
      --card:        ${theme.card};
      --text-pri:    ${theme.textPri};
      --text-sec:    ${theme.textSec};
      --text-muted:  ${theme.textMuted};
      --divider:     ${theme.divider};
      --header-bg:   ${theme.headerBg};
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      /* Use the same font as the customer home page on every booking screen
         so the whole flow feels consistent (home is hardcoded to Heebo). */
      font-family: var(--font-heebo), system-ui, -apple-system, sans-serif;
      background: ${theme.bg};
      color: ${theme.textPri};
      -webkit-font-smoothing: antialiased;
    }
  `;

  return (
    <>
      <style>{cssVars}</style>
      {children}
      <FooterCTA />
    </>
  );
}
