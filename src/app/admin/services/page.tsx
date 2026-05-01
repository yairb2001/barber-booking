"use client";

import { useEffect, useState } from "react";

type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMinutes: number;
  isVisible: boolean;
  sortOrder: number;
};

const empty = { name: "", description: "", price: "", durationMinutes: "30", isVisible: true };

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

  async function toggleVisible(id: string, current: boolean) {
    await fetch(`/api/admin/services/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isVisible: !current }),
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
    });
    setShowAdd(true);
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">שירותים</h1>
          <p className="text-neutral-500 text-sm mt-1">{services.length} שירותים</p>
        </div>
        <button
          onClick={() => { setEditing(null); setForm(empty); setShowAdd(true); }}
          className="bg-slate-900 text-neutral-950 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-slate-700 transition"
        >
          + שירות חדש
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-neutral-400">טוען...</div>
      ) : (
        <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
          {services.length === 0 ? (
            <div className="text-center py-16 text-neutral-400">אין שירותים עדיין</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50">
                  <th className="text-right px-5 py-3 text-neutral-500 font-medium">שירות</th>
                  <th className="text-right px-5 py-3 text-neutral-500 font-medium">משך</th>
                  <th className="text-right px-5 py-3 text-neutral-500 font-medium">מחיר</th>
                  <th className="text-right px-5 py-3 text-neutral-500 font-medium">מצב</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {services.map((s) => (
                  <tr key={s.id} className={`hover:bg-neutral-50 ${!s.isVisible ? "opacity-50" : ""}`}>
                    <td className="px-5 py-4">
                      <div className="font-semibold text-neutral-900">{s.name}</div>
                      {s.description && <div className="text-xs text-neutral-400">{s.description}</div>}
                    </td>
                    <td className="px-5 py-4 text-neutral-600">{s.durationMinutes} דק׳</td>
                    <td className="px-5 py-4 font-semibold text-neutral-900">₪{s.price}</td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => toggleVisible(s.id, s.isVisible)}
                        className={`text-xs px-2 py-1 rounded-full ${
                          s.isVisible
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-neutral-100 text-neutral-400"
                        }`}
                      >
                        {s.isVisible ? "גלוי" : "מוסתר"}
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => openEdit(s)}
                          className="text-xs text-slate-800 hover:underline"
                        >
                          ערוך
                        </button>
                        <button
                          onClick={() => del(s.id)}
                          className="text-xs text-red-400 hover:underline"
                        >
                          מחק
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">תיאור</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">מחיר ₪ *</label>
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700"
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
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700"
                    dir="ltr"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isVisible}
                  onChange={(e) => setForm((p) => ({ ...p, isVisible: e.target.checked }))}
                  className="accent-slate-900"
                />
                <span className="text-sm text-neutral-700">גלוי ללקוחות</span>
              </label>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={save}
                disabled={saving || !form.name.trim() || !form.price}
                className="flex-1 bg-slate-900 text-neutral-950 py-2 rounded-xl text-sm font-semibold hover:bg-slate-700 disabled:opacity-50"
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
