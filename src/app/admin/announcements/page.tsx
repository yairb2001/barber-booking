"use client";

import { useEffect, useState } from "react";

type Announcement = {
  id: string;
  title: string;
  content: string | null;
  isPinned: boolean;
  sortOrder: number;
};

const empty = { title: "", content: "", isPinned: false };

export default function AdminAnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  async function load() {
    const data = await fetch("/api/admin/announcements").then((r) => r.json());
    setItems(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    if (editing) {
      await fetch(`/api/admin/announcements/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } else {
      await fetch("/api/admin/announcements", {
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

  async function togglePin(id: string, current: boolean) {
    await fetch(`/api/admin/announcements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPinned: !current }),
    });
    load();
  }

  async function del(id: string) {
    if (!confirm("למחוק עדכון זה?")) return;
    await fetch(`/api/admin/announcements/${id}`, { method: "DELETE" });
    load();
  }

  function openEdit(item: Announcement) {
    setEditing(item);
    setForm({ title: item.title, content: item.content || "", isPinned: item.isPinned });
    setShowAdd(true);
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">עדכונים</h1>
          <p className="text-neutral-500 text-sm mt-1">הודעות ועדכונים ללקוחות</p>
        </div>
        <button
          onClick={() => { setEditing(null); setForm(empty); setShowAdd(true); }}
          className="bg-slate-900 text-neutral-950 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-slate-700 transition"
        >
          + עדכון חדש
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-neutral-400">טוען...</div>
      ) : (
        <div className="space-y-3">
          {items.length === 0 && (
            <div className="text-center py-16 text-neutral-400 bg-white rounded-2xl border border-neutral-200">
              אין עדכונים עדיין
            </div>
          )}
          {items.map((item) => (
            <div
              key={item.id}
              className={`bg-white rounded-2xl border p-5 ${item.isPinned ? "border-slate-200 bg-slate-50/30" : "border-neutral-200"}`}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5">{item.isPinned ? "📌" : "📣"}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-neutral-900">{item.title}</div>
                  {item.content && <div className="text-sm text-neutral-500 mt-1">{item.content}</div>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => togglePin(item.id, item.isPinned)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${
                      item.isPinned ? "bg-slate-100 border-slate-300 text-slate-700" : "border-neutral-200 text-neutral-400"
                    }`}
                  >
                    {item.isPinned ? "מוצמד" : "הצמד"}
                  </button>
                  <button onClick={() => openEdit(item)} className="text-xs text-slate-800 hover:underline px-1">ערוך</button>
                  <button onClick={() => del(item.id)} className="text-xs text-red-400 hover:underline px-1">מחק</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => { setShowAdd(false); setEditing(null); }}>
          <div className="bg-white rounded-2xl p-6 w-96 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-neutral-900 mb-5 text-lg">
              {editing ? "עריכת עדכון" : "עדכון חדש"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">כותרת *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">תוכן (אופציונלי)</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
                  rows={3}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700 resize-none"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isPinned}
                  onChange={(e) => setForm((p) => ({ ...p, isPinned: e.target.checked }))}
                  className="accent-slate-900"
                />
                <span className="text-sm text-neutral-700">📌 הצמד בראש הרשימה</span>
              </label>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={save}
                disabled={saving || !form.title.trim()}
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
