"use client";

import { PageHead } from "../ui";
import { AreaTabs } from "../Areas";
import Finance from "./Finance";

/** כספים: revenue, costs, and the cost of a new customer (27.10.2026). */
export default function FinancePage() {
  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <PageHead title="כספים" sub="הכנסות, עלויות, וכמה עולה לנו לקוח חדש" />
      <AreaTabs />
      <Finance />
    </div>
  );
}
