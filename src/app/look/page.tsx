"use client";

// Compare the home-page design variations: /look?v=1 (live) · 2 cream day ·
// 3 photo hero · 4 editorial. Not linked anywhere; for the owner.
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import LookHome, { type LookVariant } from "@/components/LookHome";

function Inner() {
  const v = Number(useSearchParams().get("v"));
  return <LookHome variant={([1, 2, 3, 4].includes(v) ? v : 1) as LookVariant} />;
}

export default function LookPage() {
  return <Suspense><Inner /></Suspense>;
}
