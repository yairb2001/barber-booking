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

  // Keep only the brand color from the theme.
  // Everything else (bg, text, font) is forced to the same clean slate palette
  // the admin uses — so the booking flow looks consistent and professional.
  const cssVars = `
    :root {
      --brand:       ${theme.brand};
      --brand-soft:  ${theme.brandSoft};
      --bg:          #F8FAFC;
      --bg-alt:      #F1F5F9;
      --card:        #FFFFFF;
      --text-pri:    #0F172A;
      --text-sec:    #475569;
      --text-muted:  #94A3B8;
      --divider:     #E2E8F0;
      --header-bg:   rgba(248,250,252,0.97);
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: var(--font-heebo), system-ui, -apple-system, sans-serif;
      background: #F8FAFC;
      color: #0F172A;
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
