"use client";
import { useVocab } from "@/components/VocabProvider";

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
  ownerStaffId?: string | null;
  category?: string | null;
  priceFrom?: boolean;
  rebookDays?: number | null;
  segments?: string | null;
  bufferAfterMin?: number;
};

/** "[work, wait, work]" from a service's segments, when it has that form. */
function procOf(s: Service): [number, number, number] | null {
  try {
    const x = s.segments ? (JSON.parse(s.segments) as { m: number; busy: boolean }[]) : null;
    return x && x.length === 3 && x[0].busy && !x[1].busy && x[2].busy ? [x[0].m, x[1].m, x[2].m] : null;
  } catch { return null; }
}

// category + "החל מ" (16.10.2026): grouping on the booking page, a price set at a consultation.
// rebookDays: when she usually comes back for it, the "הגיע הזמן לתור" date (beauty types).
// Stage B (16.10.2026): cleaning after the treatment, and a wait inside it
// (color processing: work → the stylist is free → work again).
const empty = { name: "", description: "", price: "", durationMinutes: "30", isVisible: true, showDuration: true, category: "", priceFrom: false, rebookDays: "", bufferAfterMin: "", proc: false, segA: "", segB: "", segC: "" };

export default function AdminServicesPage() {
  const v = useVocab();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  async function load() {
    const data = await fetch("/api/admin/services").then((r) => r.json());
    // This page manages the shared (owner) pool only — barbers' own services
    // (ownerStaffId set) are managed from each barber's page.
    setServices(Array.isArray(data) ? data.filter((s: Service) => !s.ownerStaffId) : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!form.name.trim() || !form.price) return;
    setSaving(true);
    const segs = [form.segA, form.segB, form.segC].map(x => parseInt(x));
    const procOk = form.proc && segs.every(x => x > 0);
    const { proc: _p, segA: _a, segB: _b, segC: _c, ...rest } = form;
    void _p; void _a; void _b; void _c;
    const payload = {
      ...rest,
      rebookDays: parseInt(form.rebookDays) > 0 ? parseInt(form.rebookDays) : null,
      bufferAfterMin: parseInt(form.bufferAfterMin) > 0 ? parseInt(form.bufferAfterMin) : 0,
      segments: procOk ? JSON.stringify([{ m: segs[0], busy: true }, { m: segs[1], busy: false }, { m: segs[2], busy: true }]) : null,
      ...(procOk ? { durationMinutes: String(segs[0] + segs[1] + segs[2]) } : {}),
    };
    if (editing) {
      await fetch(`/api/admin/services/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await fetch("/api/admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      category: s.category ?? "",
      priceFrom: !!s.priceFrom,
      rebookDays: s.rebookDays ? String(s.rebookDays) : "",
      bufferAfterMin: s.bufferAfterMin ? String(s.bufferAfterMin) : "",
      proc: !!procOf(s),
      segA: procOf(s) ? String(procOf(s)![0]) : "",
      segB: procOf(s) ? String(procOf(s)![1]) : "",
      segC: procOf(s) ? String(procOf(s)![2]) : "",
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

      <p className="text-xs text-neutral-400 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 mb-6 leading-relaxed">
        * שירות חדש נוסף אוטומטית לכל {v.staffPluralDef} בעסק. אם {v.staff} {v.staffFem ? "מסוימת" : "מסוים"} לא {v.staffFem ? "מבצעת" : "מבצע"} שירות מסוים —
        אפשר לכבות {v.staffFem ? "לה" : "לו"} אותו נקודתית דרך פרופיל {v.staffDef} (טאב &quot;שירותים&quot;), בלי למחוק אותו לכולם.
      </p>

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
                    {procOf(s) && <><span className="mx-1.5 text-neutral-300">·</span><span>המתנה {procOf(s)![1]} דק׳</span></>}
                    {!!s.bufferAfterMin && <><span className="mx-1.5 text-neutral-300">·</span><span>ניקוי {s.bufferAfterMin} דק׳</span></>}
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => { setShowAdd(false); setEditing(null); }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
              <div>
                <label className="text-xs text-neutral-500 block mb-1">קטגוריה <span className="text-neutral-400">(למשל: צבע, ג'ל, פנים)</span></label>
                <input
                  value={form.category}
                  onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                  list="service-categories"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
                <datalist id="service-categories">
                  {Array.from(new Set(services.map(x => x.category).filter((c): c is string => !!c))).map(c => <option key={c} value={c} />)}
                </datalist>
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

              {v.type !== "barber_men" && (
                <div className="rounded-xl border border-neutral-200 p-3 space-y-3">
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">זמן ניקוי אחרי הטיפול (דקות) <span className="text-neutral-400">({v.staffDef} {v.staffFem ? "תפוסה" : "תפוס"}, {v.customerFem ? "הלקוחה כבר יצאה" : "הלקוח כבר יצא"})</span></label>
                    <input type="number" min="0" step="5" value={form.bufferAfterMin} onChange={(e) => setForm((p) => ({ ...p, bufferAfterMin: e.target.value }))}
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" dir="ltr" placeholder="0" />
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={form.proc} onChange={(e) => setForm((p) => ({ ...p, proc: e.target.checked }))} className="accent-teal-600 w-4 h-4" />
                    <span className="text-sm text-neutral-700">יש המתנה באמצע (למשל צבע שנקלט): {v.staffDef} {v.staffFem ? "פנויה" : "פנוי"} בזמן הזה ל{v.customerFem ? "לקוחה אחרת" : "לקוח אחר"}</span>
                  </label>
                  {form.proc && (
                    <div>
                      <div className="grid grid-cols-3 gap-2">
                        {([["segA", "עבודה"], ["segB", "המתנה"], ["segC", "עבודה אחרי"]] as const).map(([k, label]) => (
                          <div key={k}>
                            <label className="text-[11px] text-neutral-500 block mb-1">{label} (דק׳)</label>
                            <input type="number" min="5" step="5" value={form[k]} onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))}
                              className="w-full border border-neutral-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" dir="ltr" />
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-neutral-500 mt-1.5">המשך הכולל יתעדכן לסכום: {[form.segA, form.segB, form.segC].reduce((t, x) => t + (parseInt(x) || 0), 0)} דק׳.</p>
                    </div>
                  )}
                </div>
              )}

              {v.type !== "barber_men" && (
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">תזכורת לחזור אחרי (ימים) <span className="text-neutral-400">(למשל: ג&apos;ל 21, צבע שורש 35. ריק = לפי הקצב של {v.customer})</span></label>
                  <input
                    type="number"
                    min="1"
                    value={form.rebookDays}
                    onChange={(e) => setForm((p) => ({ ...p, rebookDays: e.target.value }))}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                    dir="ltr"
                  />
                </div>
              )}

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
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.priceFrom}
                    onChange={(e) => setForm((p) => ({ ...p, priceFrom: e.target.checked }))}
                    className="accent-teal-600 w-4 h-4"
                  />
                  <span className="text-sm text-neutral-700">המחיר &quot;החל מ&quot; (נקבע סופית בייעוץ)</span>
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
