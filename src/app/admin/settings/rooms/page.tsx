"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Rooms (16.10.2026, Yair: "יש טיפולים שקורים בחדר מסויים, לדוגמא חדר שבו
 * מתבצע לייזר — פנימי פשוט, לא משהו חיצוני"). A list of names; under each, the
 * treatments done in it. Customers never see rooms: the system offers a time
 * only when a room is free and books the room by itself.
 */
type Room = { id: string; name: string; serviceIds: string[] };
type Svc = { id: string; name: string; category?: string | null };

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [services, setServices] = useState<Svc[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () => Promise.all([
    fetch("/api/admin/rooms").then(r => (r.ok ? r.json() : [])),
    fetch("/api/admin/services").then(r => (r.ok ? r.json() : [])),
  ]).then(([r, s]) => { setRooms(r); setServices(s); }).catch(() => setRooms([]));
  useEffect(() => { void load(); }, []);

  async function add() {
    if (!newName.trim()) return;
    setBusy(true); setError("");
    const r = await fetch("/api/admin/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) { setNewName(""); void load(); } else setError("לא נשמר, נסה שוב");
  }
  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/admin/rooms/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  }
  function toggle(room: Room, serviceId: string) {
    const serviceIds = room.serviceIds.includes(serviceId) ? room.serviceIds.filter(x => x !== serviceId) : [...room.serviceIds, serviceId];
    setRooms(rs => rs?.map(r => (r.id === room.id ? { ...r, serviceIds } : r)) ?? null);
    void patch(room.id, { serviceIds });
  }
  async function remove(room: Room) {
    if (!confirm(`להסיר את "${room.name}"? הטיפולים שלו יחזרו להיקבע בלי חדר.`)) return;
    await fetch(`/api/admin/rooms/${room.id}`, { method: "DELETE" }).catch(() => null);
    void load();
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🚪 חדרים</h1>
        <p className="text-neutral-500 text-sm mt-1 max-w-xl leading-relaxed">
          לכל חדר מסמנים אילו טיפולים נעשים בו. המערכת מציעה שעה רק כשיש חדר מתאים פנוי, ומשבצת את החדר לבד. הלקוחות לא רואים חדרים.
        </p>
      </div>

      {rooms === null ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-4 max-w-xl">
          {rooms.map(room => (
            <div key={room.id} className="bg-white rounded-2xl border border-neutral-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <input defaultValue={room.name} onBlur={e => { const n = e.target.value.trim(); if (n && n !== room.name) { void patch(room.id, { name: n }); setRooms(rs => rs?.map(r => (r.id === room.id ? { ...r, name: n } : r)) ?? null); } }}
                  className="flex-1 font-semibold text-neutral-900 border border-transparent hover:border-neutral-200 focus:border-neutral-300 rounded-lg px-2 py-1 focus:outline-none" />
                <button type="button" onClick={() => void remove(room)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg border border-neutral-200 hover:border-red-200">הסר</button>
              </div>
              <p className="text-xs text-neutral-500 mb-2">טיפולים שנעשים בחדר הזה:</p>
              <div className="flex flex-wrap gap-1.5">
                {services.map(s => {
                  const on = room.serviceIds.includes(s.id);
                  return (
                    <button key={s.id} type="button" onClick={() => toggle(room, s.id)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition ${on ? "bg-teal-600 text-white border-transparent" : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"}`}>
                      {s.name}
                    </button>
                  );
                })}
                {services.length === 0 && <span className="text-sm text-neutral-400">עוד אין שירותים.</span>}
              </div>
            </div>
          ))}

          <div className="bg-white rounded-2xl border border-dashed border-neutral-300 p-5">
            <label className="text-xs text-neutral-500 block mb-1.5">חדר חדש</label>
            <div className="flex gap-2">
              <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void add(); }} placeholder="למשל: חדר לייזר"
                className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              <button type="button" onClick={() => void add()} disabled={busy || !newName.trim()} className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">הוספה</button>
            </div>
            {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
            <p className="text-[11px] text-neutral-400 mt-2">טיפול שלא סימנת בשום חדר נקבע כמו היום, בלי חדר.</p>
          </div>
        </div>
      )}
    </div>
  );
}
