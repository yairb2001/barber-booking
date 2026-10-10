"use client";

import { C, PageHead, useCrm } from "../ui";
import { TasksPanel, type Home } from "../HomeParts";

/** What Yair has to DO: derived from the data plus his own (10.10.2026). */
export default function CrmTasks() {
  const { data, error, loading, reload } = useCrm<Home>("view=home");
  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>{loading ? "טוען…" : ""}</p>;
  const open = data.tasks.filter(t => !t.done).length;
  return (
    <div className="flex flex-col gap-4">
      <PageHead title="משימות" sub={open ? `${open} פתוחות` : "אין משימות פתוחות"} />
      <TasksPanel data={data} reload={reload} />
    </div>
  );
}
