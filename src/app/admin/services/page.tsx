"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMinutes: number;
  isVisible: boolean;
  showDuration: boolean;
  sortOrder: number;
};

const empty = { name: "", description: "", price: "", durationMinutes: "30", isVisible: true, showDuration: true };

export default function AdminServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  async function load() {
    const data = await fetch("/api/admin/services").then((r) => r.json());
    setServices(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!form.name.trim() || !form.price) return;
    setSaving(true);
    if (editing) {
      await fetch(`/api/admin/services/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } else {
      await fetch("/api/admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    }
    setSaving(false);
    setShowAdd(false);
    setEditing(null);
    setForm(empty);
    load();
  }

  async function toggle(id: string, field: "isVisible" | "showDuration", current: boolean) {
    await fetch(`/api/admin/services/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: !current }),
    });
    load();
  }

  async function del(id: string) {
    if (!confirm("למחוק שירות זה?")) return;
    await fetch(`/api/admin/services/${id}`, { method: "DELETE" });
    load();
  }

  function openEdit(s: Service) {
    setEditing(s);
    setForm({
      name: s.name,
      description: s.description || "",
      price: s.price.toString(),
      durationMinutes: s.durationMinutes.toString(),
      isVisible: s.isVisible,
      showDuration: s.showDuration,
    });
    setShowAdd(true);
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 mb-6 transition-colors">
        ← הגדרות עסק
      </Link>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">שירותים</h1>
          <p className="text-neutral-500 text-sm mt-1">{services.length} שירותים</p>
        </div>
        <button
          onClick={() => { setEditing(null); setForm(empty); setShowAdd(true); }}
          className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 transition"
        >
          + שירות חדש
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-neutral-400">טוען...</div>
      ) : (
        <div className="space-y-3">
          {services.length === 0 ? (
            <div className="text-center py-16 text-neutral-400">אין שירותים עדיין</div>
          ) : services.map((s) => (
            <div key={s.id} className={`bg-white rounded-2xl border p-4 transition ${!s.isVisible ? "border-neutral-100 opacity-60" : "border-neutral-200"}`}>
              <div className="flex items-start gap-3">
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-neutral-900">{s.name}</div>
                  {s.description && <div className="text-xs text-neutral-400 mt-0.5">{s.description}</div>}
                  <div className="text-xs text-neutral-500 mt-1">
                    <span className="font-medium text-neutral-800">₪{s.price}</span>
                    <span className="mx-1.5 text-neutral-300">·</span>
                    <span>{s.durationMinutes} דק׳</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => openEdit(s)} className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1 rounded-lg border border-neutral-200 hover:border-neutral-300 transition">
                    ✏️ ערוך
                  </button>
                  <button onClick={() => del(s.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg border border-neutral-200 hover:border-red-200 transition">
                    מחק
                  </button>
                </div>
              </div>

              {/* Toggles row */}
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-neutral-50">
                {/* isVisible toggle */}
                <button
                  onClick={() => toggle(s.id, "isVisible", s.isVisible)}
                  className="flex items-center gap-2 group"
                >
                  <div className={`relative w-9 h-5 rounded-full transition-colors ${s.isVisible ? "bg-teal-600" : "bg-neutral-300"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${s.isVisible ? "right-0.5" : "left-0.5"}`} />
                  </div>
                  <span className="text-xs text-neutral-600 group-hover:text-neutral-900 transition">
                    {s.isVisible ? "גלוי ללקוחות" : "מוסתר"}
                  </span>
                </button>

                <span className="text-neutral-200">|</span>

                {/* showDuration toggle */}
                <button
                  onClick={() => toggle(s.id, "showDuration", s.showDuration)}
                  className="flex items-center gap-2 group"
                >
                  <div className={`relative w-9 h-5 rounded-full transition-colors ${s.showDuration ? "bg-teal-600" : "bg-neutral-300"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${s.showDuration ? "right-0.5" : "left-0.5"}`} />
                  </div>
                  <span className="text-xs text-neutral-600 group-hover:text-neutral-900 transition">
                    {s.showDuration ? "משך זמן גלוי" : "משך זמן מוסתר"}
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => { setShowAdd(false); setEditing(null); }}>
          <div className="bg-white rounded-2xl p-6 w-96 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-neutral-900 mb-5 text-lg">
              {editing ? "עריכת שירות" : "שירות חדש"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">שם השירות *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">תיאור</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">מחיר ₪ *</label>
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">משך (דקות) *</label>
                  <input
                    type="number"
                    step="5"
                    value={form.durationMinutes}
                    onChange={(e) => setForm((p) => ({ ...p, durationMinutes: e.target.value }))}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                    dir="ltr"
                  />
                </div>
              </div>

              {/* Visibility toggles */}
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isVisible}
                    onChange={(e) => setForm((p) => ({ ...p, isVisible: e.target.checked }))}
                    className="accent-teal-600 w-4 h-4"
                  />
                  <span className="text-sm text-neutral-700">גלוי ללקוחות</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.showDuration}
                    onChange={(e) => setForm((p) => ({ ...p, showDuration: e.target.checked }))}
                    className="accent-teal-600 w-4 h-4"
                  />
                  <span className="text-sm text-neutral-700">הצג משך זמן ללקוחות</span>
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={save}
                disabled={saving || !form.name.trim() || !form.price}
                className="flex-1 bg-teal-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50"
              >
                {saving ? "שומר..." : "שמור"}
              </button>
              <button
                onClick={() => { setShowAdd(false); setEditing(null); }}
                className="flex-1 bg-neutral-100 text-neutral-700 py-2 rounded-xl text-sm font-medium"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
