"use client";

import { Suspense } from "react";
import CustomersList from "../customers/CustomersList";

/** Customers in setup, the most stuck first (26.10.2026: their own tab under לקוחות). */
export default function SetupPage() {
  return <Suspense fallback={<p>טוען…</p>}><CustomersList only="setup" /></Suspense>;
}
