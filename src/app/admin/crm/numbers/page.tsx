"use client";

import { PageHead } from "../ui";
import { AreaTabs } from "../Areas";
import Dashboard from "./Dashboard";

/** The SaaS dashboard (26.10.2026, replaced the month's numbers). */
export default function NumbersPage() {
  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <PageHead title="מספרים" sub="דשבורד: האם המוצר נותן ערך, איפה המשפך דולף, וכמה זה עולה" />
      <AreaTabs />
      <Dashboard />
    </div>
  );
}
