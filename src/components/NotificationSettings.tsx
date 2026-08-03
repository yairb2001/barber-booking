"use client";

import { useEffect, useState } from "react";
import EnableNotifications from "./EnableNotifications";

function parseMaybeJson(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw as Record<string, unknown>;
}

type ToggleKey = "notifyOnAppointments" | "notifyOnCancellation" | "notifyOnWaitlist" | "notifyOnEscalation";

// Self-contained "🔔 התראות" settings card: the enable button + one toggle
// per event type (default ON). Loads/saves its own state via `endpoint`
// (GET returns { settings }) so the same component serves both the owner
// (endpoint="/api/admin/business", the default) and a barber
// (endpoint={`/api/admin/staff/${myId}`}) — each gets their own device list
// and their own toggles, independent of one another.
//
// Saves via `settingsPatch` (a server-side merge against a fresh read),
// NOT a client-fetched-then-merged full `settings` object — this page has
// several OTHER independent settings toggles (theme, calendar hours, barber
// permissions, ...) that each do their own read-then-write against the same
// JSON blob with zero coordination between them. Toggling two things close
// together used to be a real "lost update": whichever save's read happened
// first would silently revert whatever the other one just wrote, once IT
// wrote back its now-stale snapshot. Server-side merge shrinks that race
// window from "however long since the tab loaded" to a couple of
// concurrent requests, milliseconds apart.
export default function NotificationSettings({ endpoint = "/api/admin/business" }: { endpoint?: string }) {
  const [toggles, setToggles] = useState<Record<ToggleKey, boolean>>({
    notifyOnAppointments: true,
    notifyOnCancellation: true,
    notifyOnWaitlist: true,
    notifyOnEscalation: true,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(endpoint)
      .then(r => r.json())
      .then(d => {
        const s = parseMaybeJson(d?.settings);
        setToggles(prev => {
          const next = { ...prev };
          (Object.keys(next) as ToggleKey[]).forEach(k => {
            if (typeof s[k] === "boolean") next[k] = s[k] as boolean;
          });
          return next;
        });
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [endpoint]);

  async function save(key: ToggleKey, value: boolean) {
    setToggles(prev => ({ ...prev, [key]: value }));
    try {
      await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settingsPatch: { [key]: value } }),
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

  const ROWS: { key: ToggleKey; icon: string; label: string; hint: string }[] = [
    { key: "notifyOnAppointments", icon: "🔔", label: "תור חדש נקבע", hint: "כשלקוח או הבוט קובעים תור חדש" },
    { key: "notifyOnCancellation", icon: "❌", label: "תור בוטל", hint: "כשלקוח מבטל תור שכבר נקבע" },
    { key: "notifyOnWaitlist", icon: "⏳", label: "הצטרפות לרשימת המתנה", hint: "כשלקוח נרשם לרשימת המתנה לתור פנוי" },
    { key: "notifyOnEscalation", icon: "👤", label: "הופנה לטיפול אנושי", hint: "כששיחה מועברת אליך מהבוט" },
  ];

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
          {ROWS.map((row, i) => (
            <div key={row.key}>
              {i > 0 && <div className="border-t border-neutral-100 mb-4" />}
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-neutral-800">{row.icon} {row.label}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">{row.hint}</p>
                </div>
                <Toggle on={toggles[row.key]} set={(v) => save(row.key, v)} />
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
