"use client";

import Script from "next/script";

/**
 * Owner-configured Meta/Facebook Pixel (Business.facebookPixel). Renders nothing
 * when no pixel is set. Shared by the public home page and the /book flow so an
 * ad that lands on "/" is tracked too (PageView + the click id cookie that lets
 * Meta credit a later Schedule to the ad). The fixed id makes next/script load
 * it once per visit even when the visitor moves from "/" into /book.
 */
export default function MetaPixel({ pixelId }: { pixelId?: string | null }) {
  const id = (pixelId ?? "").toString().trim();
  if (!/^\d{5,20}$/.test(id)) return null;
  return (
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
        fbq('init', '${id}');
        fbq('track', 'PageView');
      `}
    </Script>
  );
}
