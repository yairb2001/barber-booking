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
  upsellIds?: string | null;
  staffIds?: string[];
};
type StaffLite = { id: string; name: string };
const upsellOf = (s: Service): string[] => { try { const x = s.upsellIds ? JSON.parse(s.upsellIds) : []; return Array.isArray(x) ? x : []; } catch { return []; } };

/** "[work, wait, work, (wait, work)…]" from a service's segments, when it has that
 *  form (owner, 16.10.2026: a second wait and another round of work can be added). */
function procOf(s: Service): number[] | null {
  try {
    const x = s.segments ? (JSON.parse(s.segments) as { m: number; busy: boolean }[]) : null;
    return x && x.length >= 3 && x.length % 2 === 1 && x.every((g, i) => g.busy === (i % 2 === 0)) ? x.map(g => g.m) : null;
  } catch { return null; }
}
const waitsOf = (s: Service) => (procOf(s) ?? []).filter((_, i) => i % 2 === 1);

// category + "החל מ" (16.10.2026): grouping on the booking page, a price set at a consultation.
// rebookDays: when she usually comes back for it, the "הגיע הזמן לתור" date (beauty types).
// Stage B (16.10.2026): cleaning after the treatment, and a wait inside it
// (color processing: work → the stylist is free → work again).
const empty = { name: "", description: "", price: "", durationMinutes: "30", isVisible: true, showDuration: true, category: "", priceFrom: false, rebookDays: "", bufferAfterMin: "", proc: false, segs: ["", "", ""] as string[], upsellIds: [] as string[], staffIds: [] as string[] };

export default function AdminServicesPage() {
  const v = useVocab();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [team, setTeam] = useState<StaffLite[]>([]);

  async function load() {
    const data = await fetch("/api/admin/services").then((r) => r.json());
    // This page manages the shared (owner) pool only — barbers' own services
    // (ownerStaffId set) are managed from each barber's page.
    setServices(Array.isArray(data) ? data.filter((s: Service) => !s.ownerStaffId) : []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    fetch("/api/admin/staff").then(r => (r.ok ? r.json() : [])).then((d: StaffLite[]) => setTeam(Array.isArray(d) ? d.map(x => ({ id: x.id, name: x.name })) : [])).catch(() => {});
  }, []);

  async function save() {
    if (!form.name.trim() || !form.price) return;
    setSaving(true);
    const segs = form.segs.map(x => parseInt(x));
    const procOk = form.proc && segs.length >= 3 && segs.every(x => x > 0);
    const { proc: _p, segs: _s, ...rest } = form;
    void _p; void _s;
    const payload = {
      ...rest,
      rebookDays: parseInt(form.rebookDays) > 0 ? parseInt(form.rebookDays) : null,
      bufferAfterMin: parseInt(form.bufferAfterMin) > 0 ? parseInt(form.bufferAfterMin) : 0,
      segments: procOk ? JSON.stringify(segs.map((m, i) => ({ m, busy: i % 2 === 0 }))) : null,
      ...(procOk ? { durationMinutes: String(segs.reduce((t, x) => t + x, 0)) } : {}),
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
      segs: procOf(s) ? procOf(s)!.map(String) : ["", "", ""],
      upsellIds: upsellOf(s),
      staffIds: s.staffIds ?? [],
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
          onClick={() => { setEditing(null); setForm({ ...empty, staffIds: team.map(t => t.id) }); setShowAdd(true); }}
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
                    {procOf(s) && <><span className="mx-1.5 text-neutral-300">·</span><span>המתנה {waitsOf(s).join(" + ")} דק׳</span></>}
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
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  rows={2}
                  placeholder="מה כלול, למי זה מתאים, כמה זמן מחזיק"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
                {/* 16.10.2026, Yair: the agent answers "what is it" from here. */}
                <p className="text-[11px] text-neutral-400 mt-1">הסוכן קורא את התיאור: כשלקוח שואל מה זה או מה כלול, הוא מפרט מכאן.</p>
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
                        {form.segs.map((val, i) => (
                          <div key={i}>
                            <label className="text-[11px] text-neutral-500 block mb-1">{i % 2 === 1 ? "המתנה" : i === 0 ? "עבודה" : "עבודה אחרי"} (דק׳)</label>
                            <input type="number" min="5" step="5" value={val} onChange={(e) => setForm((p) => ({ ...p, segs: p.segs.map((x, j) => (j === i ? e.target.value : x)) }))}
                              className="w-full border border-neutral-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" dir="ltr" />
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <button type="button" onClick={() => setForm(p => ({ ...p, segs: [...p.segs, "", ""] }))} className="text-xs font-semibold text-teal-700">+ עוד המתנה ועבודה</button>
                        {form.segs.length > 3 && (
                          <button type="button" onClick={() => setForm(p => ({ ...p, segs: p.segs.slice(0, -2) }))} className="text-xs text-neutral-400">הסר את האחרונה</button>
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-500 mt-1.5">המשך הכולל יתעדכן לסכום: {form.segs.reduce((t, x) => t + (parseInt(x) || 0), 0)} דק׳.</p>
                    </div>
                  )}
                </div>
              )}

              {team.length > 0 && (
                <div>
                  <label className="text-xs text-neutral-500 block mb-1.5">מי מהצוות מבצע את השירות</label>
                  <div className="flex flex-wrap gap-1.5">
                    {team.map(t => {
                      const on = form.staffIds.includes(t.id);
                      return (
                        <button key={t.id} type="button" onClick={() => setForm(p => ({ ...p, staffIds: on ? p.staffIds.filter(i => i !== t.id) : [...p.staffIds, t.id] }))}
                          className={`px-3 py-1 rounded-full text-xs border transition ${on ? "bg-teal-600 text-white border-transparent" : "bg-white border-neutral-200 text-neutral-600"}`}>
                          {on ? "✓ " : ""}{t.name}
                        </button>
                      );
                    })}
                  </div>
                  {form.staffIds.length === 0 && <p className="text-[11px] text-amber-700 mt-1">אף אחד לא נבחר — אי אפשר יהיה לקבוע את השירות הזה.</p>}
                </div>
              )}

              {v.type !== "barber_men" && services.some(x => x.id !== editing?.id) && (
                <div>
                  <label className="text-xs text-neutral-500 block mb-1.5">מה הסוכן מציע מיד אחרי הטיפול הזה <span className="text-neutral-400">(ריק = מה {v.customerFem ? "שהלקוחה נוהגת" : "שהלקוח נוהג"} להוסיף)</span></label>
                  <div className="flex flex-wrap gap-1.5">
                    {services.filter(x => x.id !== editing?.id).map(x => {
                      const on = form.upsellIds.includes(x.id);
                      return (
                        <button key={x.id} type="button" onClick={() => setForm(p => ({ ...p, upsellIds: on ? p.upsellIds.filter(i => i !== x.id) : [...p.upsellIds, x.id] }))}
                          className={`px-3 py-1 rounded-full text-xs border transition ${on ? "bg-teal-600 text-white border-transparent" : "bg-white border-neutral-200 text-neutral-600"}`}>
                          {x.name}
                        </button>
                      );
                    })}
                  </div>
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
