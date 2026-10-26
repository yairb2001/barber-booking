"use client";

import { Suspense } from "react";
import CustomersList from "./CustomersList";

/** Active customers: live, needing care, suspended (the in-setup ones are /admin/crm/setup). */
export default function CustomersPage() {
  return <Suspense fallback={<p>טוען…</p>}><CustomersList only="active" /></Suspense>;
}
