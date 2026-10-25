"use client";

import { C, PageHead, useCrm } from "../ui";
import { AreaTabs } from "../Areas";
import { Numbers, type Home } from "../HomeParts";

/** The business numbers (16.10.2026: moved off the home, which became "היום"). */
export default function NumbersPage() {
  const { data, error, loading } = useCrm<Home>("view=home");
  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>{loading ? "טוען…" : ""}</p>;
  return (
    <div className="flex flex-col gap-4">
      <PageHead title="מספרים" sub="החודש, מהתחלת החודש" />
      <AreaTabs />
      <Numbers data={data} />
    </div>
  );
}
