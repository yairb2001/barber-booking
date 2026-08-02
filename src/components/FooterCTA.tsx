"use client";

import { useSlug } from "@/lib/public-nav";
import BusinessSwitcher from "@/components/BusinessSwitcher";

export default function FooterCTA() {
  const slug = useSlug();

  return (
    <div className="py-6 text-center bg-neutral-50 border-t border-neutral-100 space-y-3">
      <p className="text-[12px] text-neutral-400 leading-relaxed">
        רוצה מערכת מתקדמת כזו לעסק שלך?{" "}
        <a
          href="/for-business"
          className="font-semibold underline underline-offset-2"
          style={{ color: "var(--brand, #D4AF37)" }}
        >
          לחץ כאן
        </a>
      </p>

      <div className="flex items-center justify-center gap-4">
        <BusinessSwitcher currentSlug={slug} />
        <span className="text-neutral-300 text-[12px]">·</span>
        <a href="/admin" className="text-[12px] text-neutral-400 underline underline-offset-2 hover:text-neutral-600 transition">
          כניסה לניהול
        </a>
      </div>
    </div>
  );
}
