"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import NotificationSettings from "@/components/NotificationSettings";

export default function BarberNotificationsPage() {
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/me").then(r => (r.ok ? r.json() : null)).then(me => {
      if (me?.staffId) setMyId(me.staffId);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 sm:p-8 overflow-auto h-full">
      <Link href="/admin/barber-settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות שלי</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🔔 התראות</h1>
        <p className="text-neutral-500 text-sm mt-1">על אילו אירועים לקבל התראה למכשיר שלך</p>
      </div>

      <div className="max-w-xl">
        {loading ? (
          <div className="text-center py-16 text-neutral-400">טוען...</div>
        ) : myId ? (
          // Scoped to this barber's own device list + toggles.
          <NotificationSettings endpoint={`/api/admin/staff/${myId}`} />
        ) : (
          <p className="text-sm text-neutral-400 text-center py-10">לא נמצא פרופיל ספר מקושר לחשבון הזה.</p>
        )}
      </div>
    </div>
  );
}
