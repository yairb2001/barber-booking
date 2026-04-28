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

  const cssVars = `
    :root {
      --brand:        ${theme.brand};
      --brand-soft:   ${theme.brandSoft};
      --bg:           ${theme.bg};
      --bg-alt:       ${theme.bgAlt};
      --card:         ${theme.card};
      --text-pri:     ${theme.textPri};
      --text-sec:     ${theme.textSec};
      --text-muted:   ${theme.textMuted};
      --divider:      ${theme.divider};
      --header-bg:    ${theme.headerBg};
      --font-display: ${theme.fontDisplay};
      --font-body:    ${theme.fontBody};
    }
    body { font-family: var(--font-body); background: var(--bg); color: var(--text-pri); }
  `;

  return (
    <>
      <style>{cssVars}</style>
      {children}
      <FooterCTA />
    </>
  );
}
