"use client";

import { C, PageHead, useCrm } from "../ui";
import { AlertsPanel, type Notif } from "../HomeParts";

/** What HAPPENED, read/unread. Opened from the bell in the header. */
export default function CrmAlerts() {
  const { data, error, loading, reload } = useCrm<{ notifications: Notif[]; unread: number }>("view=alerts");
  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>{loading ? "טוען…" : ""}</p>;
  return (
    <div className="flex flex-col gap-4">
      <PageHead title="התראות" />
      <AlertsPanel data={data} reload={reload} />
    </div>
  );
}
