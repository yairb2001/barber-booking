"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type StaffRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  canViewAllCalendars: boolean;
  canViewAllChats: boolean;
  canUseOwnerAgent: boolean;
};

// The three permissions that are stored PER BARBER, on their own Staff row.
// These columns are what getEffectivePermissions actually gates on at runtime,
// so this table is the source of truth — not the business `settings` JSON.
const PER_STAFF = [
  { key: "canViewAllCalendars", short: "יומנים", label: "צפייה ביומנים של ספרים אחרים" },
  { key: "canViewAllChats", short: "שיחות", label: "גישה לשיחות WhatsApp" },
  { key: "canUseOwnerAgent", short: "סוכן מנהל", label: "שליחת פקודות ניהול לסוכן בוואטסאפ" },
] as const;

type PermKey = (typeof PER_STAFF)[number]["key"];

export default function PermissionsPage() {
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // Genuinely business-wide — these have no per-barber column.
  const [staffManageOwnServices, setStaffManageOwnServices] = useState(false);
  const [barbersCanViewAllCustomers, setBarbersCanViewAllCustomers] = useState(true);
  const [savingGlobal, setSavingGlobal] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/business").then(r => r.json()),
      fetch("/api/admin/staff").then(r => r.json()),
    ]).then(([biz, list]) => {
      if (biz) {
        setStaffManageOwnServices(biz.staffManageOwnServices ?? false);
        const s = biz.settings || {};
        if (typeof s.barbersCanViewAllCustomers === "boolean") setBarbersCanViewAllCustomers(s.barbersCanViewAllCustomers);
      }
      setStaff(Array.isArray(list) ? list.map((m: StaffRow) => ({
        id: m.id,
        name: m.name,
        avatarUrl: m.avatarUrl ?? null,
        canViewAllCalendars: !!m.canViewAllCalendars,
        canViewAllChats: !!m.canViewAllChats,
        canUseOwnerAgent: !!m.canUseOwnerAgent,
      })) : []);
      setLoading(false);
    });
  }, []);

  async function saveGlobal(patch: { staffManageOwnServices?: boolean; barbersCanViewAllCustomers?: boolean }) {
    setSavingGlobal(true);
    const body: Record<string, unknown> = {};
    if (patch.staffManageOwnServices !== undefined) body.staffManageOwnServices = patch.staffManageOwnServices;
    if (patch.barbersCanViewAllCustomers !== undefined) body.settingsPatch = { barbersCanViewAllCustomers: patch.barbersCanViewAllCustomers };
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSavingGlobal(false);
  }

  // Writes straight to the Staff row. Deliberately does NOT also write the
  // legacy business-wide JSON keys — one writer means the table can never drift
  // from what the app actually enforces.
  async function setPerm(staffId: string, key: PermKey, value: boolean) {
    setStaff(prev => prev.map(m => (m.id === staffId ? { ...m, [key]: value } : m)));
    setBusy(`${staffId}:${key}`);
    await fetch(`/api/admin/staff/${staffId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    setBusy(null);
  }

  async function setAll(key: PermKey, value: boolean) {
    const targets = staff.filter(m => m[key] !== value);
    if (targets.length === 0) return;
    setStaff(prev => prev.map(m => ({ ...m, [key]: value })));
    setBusy(`all:${key}`);
    await Promise.all(targets.map(m =>
      fetch(`/api/admin/staff/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      })
    ));
    setBusy(null);
  }

  return (
    <div className="p-6 sm:p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">👥 הרשאות ספרים</h1>
        <p className="text-neutral-500 text-sm mt-1">מה כל ספר יכול לראות ולעשות במערכת</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-4 max-w-2xl">

          {/* ── Per-barber matrix ── */}
          <section className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-100">
              <h2 className="font-semibold text-neutral-800">לפי ספר</h2>
              <p className="text-xs text-neutral-400 mt-0.5">כל שינוי נשמר מיד</p>
            </div>

            {staff.length === 0 ? (
              <p className="text-sm text-neutral-400 text-center py-10">אין ספרים פעילים</p>
            ) : (
              <div className="p-3">
                {/* Column headers + apply-to-all */}
                <div className="grid grid-cols-[1fr_repeat(3,3.6rem)] sm:grid-cols-[1fr_repeat(3,5rem)] gap-1 items-end px-2 pb-2">
                  <span className="text-xs text-neutral-400">החל על כולם ↓</span>
                  {PER_STAFF.map(p => {
                    const allOn = staff.length > 0 && staff.every(m => m[p.key]);
                    return (
                      <button key={p.key}
                        onClick={() => setAll(p.key, !allOn)}
                        disabled={busy !== null}
                        title={p.label}
                        className="flex flex-col items-center gap-1 group disabled:opacity-50">
                        <span className="text-[10px] sm:text-[11px] text-neutral-500 text-center leading-tight">{p.short}</span>
                        <span className={`w-9 h-5 rounded-full relative transition-colors border-2 border-dashed ${allOn ? "bg-teal-100 border-teal-400" : "bg-neutral-100 border-neutral-300"} group-hover:border-teal-500`}>
                          <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${allOn ? "right-0.5 bg-teal-600" : "left-0.5 bg-neutral-400"}`} />
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* One row per barber */}
                <div className="space-y-1">
                  {staff.map(m => (
                    <div key={m.id}
                      className="grid grid-cols-[1fr_repeat(3,3.6rem)] sm:grid-cols-[1fr_repeat(3,5rem)] gap-1 items-center bg-neutral-50/70 rounded-xl px-2 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {m.avatarUrl
                          ? <img src={m.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                          : <span className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 text-xs font-bold flex items-center justify-center shrink-0">{m.name[0]}</span>}
                        <span className="text-sm font-medium text-neutral-800 truncate">{m.name}</span>
                      </div>
                      {PER_STAFF.map(p => (
                        <div key={p.key} className="flex justify-center">
                          <button
                            onClick={() => setPerm(m.id, p.key, !m[p.key])}
                            disabled={busy !== null}
                            title={p.label}
                            className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${m[p.key] ? "bg-teal-600" : "bg-neutral-300"}`}>
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${m[p.key] ? "right-0.5" : "left-0.5"}`} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Legend — the column headers are abbreviations */}
                <dl className="mt-3 pt-3 border-t border-neutral-100 space-y-1 px-2">
                  {PER_STAFF.map(p => (
                    <div key={p.key} className="flex gap-2 text-[11px] leading-relaxed">
                      <dt className="text-neutral-500 font-medium shrink-0">{p.short}</dt>
                      <dd className="text-neutral-400">{p.label}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </section>

          {/* ── Business-wide ── */}
          <section className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-100">
              <h2 className="font-semibold text-neutral-800">חל על כל הצוות</h2>
              <p className="text-xs text-neutral-400 mt-0.5">הגדרות שאין להן ערך נפרד לכל ספר</p>
            </div>
            <div className="p-3 space-y-1">
              <label className="flex items-start gap-3 bg-neutral-50/70 rounded-xl px-3.5 py-3 cursor-pointer">
                <button
                  onClick={() => { const v = !staffManageOwnServices; setStaffManageOwnServices(v); saveGlobal({ staffManageOwnServices: v }); }}
                  disabled={savingGlobal}
                  className={`relative w-10 h-5 rounded-full transition-colors shrink-0 mt-0.5 disabled:opacity-50 ${staffManageOwnServices ? "bg-teal-600" : "bg-neutral-300"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${staffManageOwnServices ? "right-0.5" : "left-0.5"}`} />
                </button>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-800">כל ספר מנהל את השירותים שלו</p>
                  <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
                    {staffManageOwnServices
                      ? "כל ספר יכול להוסיף, לערוך ולמחוק שירותים משלו, בלי תלות בשירותי המנהל."
                      : "המנהל הראשי קובע את השירותים לכולם. הספרים בוחרים רק מתוך הרשימה הקיימת."}
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 bg-neutral-50/70 rounded-xl px-3.5 py-3 cursor-pointer">
                <button
                  onClick={() => { const v = !barbersCanViewAllCustomers; setBarbersCanViewAllCustomers(v); saveGlobal({ barbersCanViewAllCustomers: v }); }}
                  disabled={savingGlobal}
                  className={`relative w-10 h-5 rounded-full transition-colors shrink-0 mt-0.5 disabled:opacity-50 ${barbersCanViewAllCustomers ? "bg-teal-600" : "bg-neutral-300"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${barbersCanViewAllCustomers ? "right-0.5" : "left-0.5"}`} />
                </button>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-800">צפייה וקביעת תור לכל לקוחות המספרה</p>
                  <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
                    ספרים יוכלו לחפש ולקבוע תור לכל לקוח של העסק — לא רק ללקוחות שלהם
                  </p>
                </div>
              </label>
            </div>
          </section>

          {/* Pointer — cancellation policy moved to the calendar page */}
          <Link href="/admin/settings/calendar"
            className="flex items-center gap-3 bg-white border border-neutral-200 rounded-xl px-4 py-3.5 hover:border-teal-300 hover:bg-teal-50/40 transition group">
            <span className="text-xl">📅</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-neutral-800">מדיניות ביטולים</p>
              <p className="text-xs text-neutral-400 mt-0.5">נמצאת במסך &quot;יומן ותורים&quot;</p>
            </div>
            <span className="text-neutral-300 group-hover:text-teal-500 transition">‹</span>
          </Link>
        </div>
      )}
    </div>
  );
}
