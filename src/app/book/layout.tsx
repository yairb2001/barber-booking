"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import FooterCTA from "@/components/FooterCTA";
import { type Theme } from "@/lib/themes";
import { useServerTheme } from "@/components/ThemeProvider";
import { useSlug, apiWithSlug } from "@/lib/public-nav";
import { captureAttribution } from "@/lib/attribution";

export default function BookLayout({ children }: { children: React.ReactNode }) {
  // Start from the server-resolved theme so the first paint is correct
  // (no flash of the default gold theme before the client fetch resolves).
  const slug = useSlug();
  const serverTheme = useServerTheme();
  const [theme, setTheme] = useState<Theme>(serverTheme);
  // Owner-configured Meta/Facebook Pixel ID (null = no tracking). Loaded from
  // the same /api/business fetch and injected once for the whole booking flow,
  // so PageView fires on every /book step (the "entered the site" audience).
  const [pixelId, setPixelId] = useState<string | null>(null);

  useEffect(() => {
    // Capture marketing attribution (?ref / ?utm_*) as soon as the visitor
    // lands, before they navigate deeper into the flow (params drop off).
    captureAttribution();
    fetch(apiWithSlug("/api/business", slug))
      .then(r => r.json())
      .then(biz => {
        if (biz?.theme) setTheme(biz.theme);
        if (biz?.facebookPixel) setPixelId(String(biz.facebookPixel));
      })
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
      {pixelId && (
        <Script id="fb-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${pixelId}');
            fbq('track', 'PageView');
          `}
        </Script>
      )}
      {children}
      <FooterCTA />
    </>
  );
}
