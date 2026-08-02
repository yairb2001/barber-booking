"use client";

import { useEffect, useState } from "react";
import EnableNotifications from "./EnableNotifications";

// Self-contained "🔔 התראות" settings card: the enable button + the two
// per-type toggles (default ON). Loads/saves its own state via /api/admin/business
// so it can be dropped into the settings page with a single insertion.
export default function NotificationSettings() {
  const [appts, setAppts] = useState(true);
  const [escal, setEscal] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business")
      .then(r => r.json())
      .then(d => {
        const s = (d && d.settings) || {};
        if (typeof s.notifyOnAppointments === "boolean") setAppts(s.notifyOnAppointments);
        if (typeof s.notifyOnEscalation === "boolean") setEscal(s.notifyOnEscalation);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save(patch: { notifyOnAppointments?: boolean; notifyOnEscalation?: boolean }) {
    try {
      const d = await fetch("/api/admin/business").then(r => r.json());
      const current = (d && d.settings) || {};
      await fetch("/api/admin/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { ...current, ...patch } }),
      });
    } catch { /* ignore — UI already reflects the intended state */ }
  }

  const Toggle = ({ on, set }: { on: boolean; set: (v: boolean) => void }) => (
    <button
      onClick={() => set(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 mr-4 ${on ? "bg-teal-600" : "bg-neutral-300"}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? "right-0.5" : "left-0.5"}`} />
    </button>
  );

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">🔔</span>
        <h3 className="text-sm font-semibold text-neutral-900">התראות פוש</h3>
      </div>
      <p className="text-xs text-neutral-500 mb-3 leading-relaxed">
        קבל התראות לטלפון על אירועים חשובים. באייפון — קודם &quot;הוסף למסך הבית&quot;, פתח משם, ואז הפעל כאן.
      </p>

      <EnableNotifications />

      {loaded && (
        <div className="mt-4 pt-4 border-t border-neutral-100 space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-neutral-800">🔔 תור חדש נקבע</p>
              <p className="text-xs text-neutral-400 mt-0.5">כשלקוח או הבוט קובעים תור חדש</p>
            </div>
            <Toggle on={appts} set={(v) => { setAppts(v); save({ notifyOnAppointments: v }); }} />
          </label>
          <div className="border-t border-neutral-100" />
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-neutral-800">👤 הופנה לטיפול אנושי</p>
              <p className="text-xs text-neutral-400 mt-0.5">כששיחה מועברת אליך מהבוט</p>
            </div>
            <Toggle on={escal} set={(v) => { setEscal(v); save({ notifyOnEscalation: v }); }} />
          </label>
        </div>
      )}
    </div>
  );
}
