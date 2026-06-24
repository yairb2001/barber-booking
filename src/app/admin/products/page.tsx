"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  isVisible: boolean;
  sortOrder: number;
};

const empty = { name: "", description: "", price: "", imageUrl: "", isVisible: true };

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function load() {
    const data = await fetch("/api/admin/products").then((r) => r.json());
    setProducts(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!form.name.trim() || !form.price) return;
    setSaving(true);
    if (editing) {
      await fetch(`/api/admin/products/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } else {
      await fetch("/api/admin/products", {
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
    await fetch(`/api/admin/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isVisible: !current }),
    });
    load();
  }

  async function del(id: string) {
    if (!confirm("למחוק מוצר זה?")) return;
    const res = await fetch(`/api/admin/products/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("מחיקת המוצר נכשלה. נסה שוב.");
      return;
    }
    // Optimistic remove so it disappears immediately, then re-sync.
    setProducts((prev) => prev.filter((p) => p.id !== id));
    load();
  }

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const { compressImage } = await import("@/lib/image-compress");
      const compressed = await compressImage(file, "portfolio");
      const fd = new FormData();
      fd.append("file", compressed);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.url) {
        setForm((p) => ({ ...p, imageUrl: data.url }));
      } else {
        alert(data.error || "העלאת התמונה נכשלה");
      }
    } catch {
      alert("העלאת התמונה נכשלה");
    } finally {
      setUploading(false);
    }
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description || "",
      price: p.price.toString(),
      imageUrl: p.imageUrl || "",
      isVisible: p.isVisible,
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
          <h1 className="text-2xl font-bold text-neutral-900">מוצרים</h1>
          <p className="text-neutral-500 text-sm mt-1">קטלוג מוצרים</p>
        </div>
        <button
          onClick={() => { setEditing(null); setForm(empty); setShowAdd(true); }}
          className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 transition"
        >
          + מוצר חדש
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-neutral-400">טוען...</div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {products.length === 0 && (
            <div className="col-span-2 text-center py-16 text-neutral-400 bg-white rounded-2xl border border-neutral-200">
              אין מוצרים עדיין
            </div>
          )}
          {products.map((p) => (
            <div
              key={p.id}
              className={`bg-white rounded-2xl border p-4 ${!p.isVisible ? "opacity-50" : "border-neutral-200"}`}
            >
              <div className="flex gap-3">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-neutral-100 flex items-center justify-center text-2xl shrink-0">🛍️</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-neutral-900">{p.name}</div>
                  {p.description && <div className="text-xs text-neutral-400 mt-0.5 line-clamp-2">{p.description}</div>}
                  <div className="font-bold text-slate-800 mt-1">₪{p.price}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-neutral-100">
                <button
                  onClick={() => toggleVisible(p.id, p.isVisible)}
                  className={`text-xs px-2 py-1 rounded-full ${p.isVisible ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-400"}`}
                >
                  {p.isVisible ? "גלוי" : "מוסתר"}
                </button>
                <div className="flex-1" />
                <button onClick={() => openEdit(p)} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-neutral-100 text-slate-800 hover:bg-neutral-200">ערוך</button>
                <button onClick={() => del(p.id)} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100">מחק</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => { setShowAdd(false); setEditing(null); }}>
          <div className="bg-white rounded-2xl p-6 w-96 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-neutral-900 mb-5 text-lg">
              {editing ? "עריכת מוצר" : "מוצר חדש"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">שם המוצר *</label>
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
                <label className="text-xs text-neutral-500 block mb-1">תמונת מוצר</label>
                <div className="flex items-center gap-3">
                  {form.imageUrl ? (
                    <img src={form.imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0 border border-neutral-200" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-neutral-100 flex items-center justify-center text-2xl shrink-0">🛍️</div>
                  )}
                  <div className="flex-1">
                    <label className={`block text-center text-sm font-medium px-3 py-2 rounded-lg cursor-pointer ${uploading ? "bg-neutral-100 text-neutral-400" : "bg-teal-50 text-teal-700 hover:bg-teal-100"}`}>
                      {uploading ? "מעלה..." : form.imageUrl ? "החלף תמונה" : "העלאת תמונה"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploading}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }}
                      />
                    </label>
                    {form.imageUrl && (
                      <button
                        type="button"
                        onClick={() => setForm((p) => ({ ...p, imageUrl: "" }))}
                        className="block w-full text-center text-xs text-red-400 hover:underline mt-1"
                      >
                        הסר תמונה
                      </button>
                    )}
                  </div>
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
