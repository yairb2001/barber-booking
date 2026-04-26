"use client";

import { useEffect, useState } from "react";
import FooterCTA from "@/components/FooterCTA";

export default function BookLayout({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState("#D4AF37");

  useEffect(() => {
    fetch("/api/business")
      .then(r => r.json())
      .then(biz => { if (biz?.brandColor) setBrand(biz.brandColor); })
      .catch(() => {});
  }, []);

  return (
    <>
      <style>{`:root { --brand: ${brand}; }`}</style>
      {children}
      <FooterCTA />
    </>
  );
}
