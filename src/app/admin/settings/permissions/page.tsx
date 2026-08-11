"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function PermissionsPage() {
  const [loading, setLoading] = useState(true);

  // "Who's in charge" toggles — services, calendars, chats, customers
  const [staffManageOwnServices, setStaffManageOwnServices] = useState(false);
  const [savingSvcMode, setSavingSvcMode] = useState(false);
  const [barbersCanViewOthersCalendar, setBarbersCanViewOthersCalendar] = useState(false);
  const [barbersCanAccessChats, setBarbersCanAccessChats] = useState(false);
  const [barbersCanViewAllCustomers, setBarbersCanViewAllCustomers] = useState(true);
  const [barberPermsSaving, setBarberPermsSaving] = useState(false);
  const [barberPermsSaved, setBarberPermsSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business").then(r => r.json()).then(data => {
      if (data) {
        setStaffManageOwnServices(data.staffManageOwnServices ?? false);
        const s = data.settings || {};
        if (typeof s.barbersCanViewOthersCalendar === "boolean") setBarbersCanViewOthersCalendar(s.barbersCanViewOthersCalendar);
        if (typeof s.barbersCanAccessChats === "boolean") setBarbersCanAccessChats(s.barbersCanAccessChats);
        if (typeof s.barbersCanViewAllCustomers === "boolean") setBarbersCanViewAllCustomers(s.barbersCanViewAllCustomers);
      }
      setLoading(false);
    });
  }, []);

  async function saveStaffServicesMode(value: boolean) {
    setStaffManageOwnServices(value);
    setSavingSvcMode(true);
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffManageOwnServices: value }),
    });
    setSavingSvcMode(false);
  }

  async function saveBarberPerms() {
    setBarberPermsSaving(true);
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settingsPatch: { barbersCanViewOthersCalendar, barbersCanAccessChats, barbersCanViewAllCustomers } }),
    });
    setBarberPermsSaving(false);
    setBarberPermsSaved(true);
    setTimeout(() => setBarberPermsSaved(false), 2500);
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">👥 הרשאות ספרים</h1>
        <p className="text-neutral-500 text-sm mt-1">מה ספרים יכולים לראות ולעשות במערכת</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-5 max-w-xl">
          {/* Who manages services */}
          <div className="bg-white border border-neutral-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <button
                onClick={() => saveStaffServicesMode(!staffManageOwnServices)}
                disabled={savingSvcMode}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${staffManageOwnServices ? "bg-teal-500" : "bg-neutral-200"}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${staffManageOwnServices ? "right-0.5" : "left-0.5"}`} />
              </button>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-800">כל ספר מנהל את השירותים שלו</p>
                <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
                  {staffManageOwnServices
                    ? "כל ספר יכול להוסיף, לערוך ולמחוק שירותים משלו, בלי תלות בשירותי המנהל."
                    : "המנהל הראשי קובע את השירותים לכולם. הספרים בוחרים רק מתוך הרשימה הקיימת."}
                </p>
              </div>
            </div>
          </div>

          {/* Barber permissions */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-neutral-800">הרשאות ספרים</h2>
                <p className="text-xs text-neutral-400 mt-0.5">שלוט במה שספרים יכולים לראות ולעשות</p>
              </div>
              <button onClick={saveBarberPerms} disabled={barberPermsSaving}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${barberPermsSaved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
                {barberPermsSaving ? "שומר..." : barberPermsSaved ? "✓ נשמר" : "שמור"}
              </button>
            </div>
            <div className="space-y-4">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-neutral-800">צפייה ביומנים של ספרים אחרים</p>
                  <p className="text-xs text-neutral-400 mt-0.5">ספרים יוכלו לעבור בין יומנים — ברירת המחדל תמיד היומן שלהם</p>
                </div>
                <button onClick={() => setBarbersCanViewOthersCalendar(v => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 mr-4 ${barbersCanViewOthersCalendar ? "bg-teal-600" : "bg-neutral-300"}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${barbersCanViewOthersCalendar ? "right-0.5" : "left-0.5"}`} />
                </button>
              </label>
              <div className="border-t border-neutral-100" />
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-neutral-800">גישה לשיחות WhatsApp</p>
                  <p className="text-xs text-neutral-400 mt-0.5">ספרים יראו שיחות WhatsApp עם לקוחות שלהם בלבד</p>
                </div>
                <button onClick={() => setBarbersCanAccessChats(v => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 mr-4 ${barbersCanAccessChats ? "bg-teal-600" : "bg-neutral-300"}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${barbersCanAccessChats ? "right-0.5" : "left-0.5"}`} />
                </button>
              </label>
              <div className="border-t border-neutral-100" />
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-neutral-800">צפייה וקביעת תור לכל לקוחות המספרה</p>
                  <p className="text-xs text-neutral-400 mt-0.5">ספרים יוכלו לחפש ולקבוע תור לכל לקוח של העסק — לא רק ללקוחות שלהם</p>
                </div>
                <button onClick={() => setBarbersCanViewAllCustomers(v => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 mr-4 ${barbersCanViewAllCustomers ? "bg-teal-600" : "bg-neutral-300"}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${barbersCanViewAllCustomers ? "right-0.5" : "left-0.5"}`} />
                </button>
              </label>
            </div>
          </div>

          {/* Pointer — cancellation policy moved to the calendar page */}
          <Link href="/admin/settings/calendar"
            className="flex items-center gap-3 bg-white border border-neutral-200 rounded-xl px-4 py-3.5 hover:border-teal-300 hover:bg-teal-50/40 transition group">
            <span className="text-xl">📅</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-neutral-800">מדיניות ביטולים</p>
              <p className="text-xs text-neutral-400 mt-0.5">עברה למסך &quot;יומן ותורים&quot;</p>
            </div>
            <span className="text-neutral-300 group-hover:text-teal-500 transition">‹</span>
          </Link>
        </div>
      )}
    </div>
  );
}
