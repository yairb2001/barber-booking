"use client";

import { useEffect, useState } from "react";
import FooterCTA from "@/components/FooterCTA";
import { THEMES, type Theme } from "@/lib/themes";

export default function BookLayout({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(THEMES.onyx);

  useEffect(() => {
    fetch("/api/business")
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
      font-family: ${theme.fontBody}, system-ui, -apple-system, sans-serif;
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
