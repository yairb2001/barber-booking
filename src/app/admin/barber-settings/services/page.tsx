"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMinutes: number;
  enabled: boolean;
  owned: boolean;
  customPrice: number | null;
  customDuration: number | null;
  customName: string | null;
  customDescription: string | null;
  customNote: string | null;
};

export default function BarberServicesPage() {
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [services, setServices] = useState<ServiceRow[]>([]);
  const [editingSvc, setEditingSvc] = useState<string | null>(null);
  const [customPrice, setCustomPrice] = useState("");
  const [customDuration, setCustomDuration] = useState("");
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customNote, setCustomNote] = useState("");
  const [svcSaved, setSvcSaved] = useState(false);

  // Own services (the barber's private services)
  const [canManageOwn, setCanManageOwn] = useState(false);
  const [ownForm, setOwnForm] = useState<{ id: string | null; name: string; description: string; price: string; durationMinutes: string } | null>(null);

  async function loadServices(id: string) {
    const data = await fetch(`/api/admin/staff/${id}/services`).then(r => r.json());
    // New shape: { canManageOwn, services }. Backward-compat: plain array.
    if (Array.isArray(data)) {
      setServices(data);
    } else {
      setServices(Array.isArray(data.services) ? data.services : []);
      setCanManageOwn(!!data.canManageOwn);
    }
  }

  useEffect(() => {
    (async () => {
      const me = await fetch("/api/admin/me").then(r => (r.ok ? r.json() : null));
      if (!me?.staffId) { setLoading(false); return; }
      setMyId(me.staffId);
      await loadServices(me.staffId);
      setLoading(false);
    })();
  }, []);

  async function toggleService(serviceId: string, enabled: boolean) {
    if (!myId) return;
    setSaving(true);
    await fetch(`/api/admin/staff/${myId}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId, enabled }),
    });
    await loadServices(myId);
    setSaving(false);
  }

  async function saveCustom(serviceId: string) {
    if (!myId) return;
    setSaving(true);
    await fetch(`/api/admin/staff/${myId}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId,
        enabled: true,
        customPrice: customPrice ? Number(customPrice) : null,
        customDuration: customDuration ? Number(customDuration) : null,
        customName: customName.trim() || null,
        customDescription: customDescription.trim() || null,
        customNote: customNote.trim() || null,
      }),
    });
    setEditingSvc(null);
    await loadServices(myId);
    setSaving(false);
    setSvcSaved(true);
    setTimeout(() => setSvcSaved(false), 2000);
  }

  async function saveOwnService() {
    if (!myId || !ownForm) return;
    if (!ownForm.name.trim() || !ownForm.price || !ownForm.durationMinutes) return;
    setSaving(true);
    await fetch(`/api/admin/staff/${myId}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: ownForm.id ? "update-own" : "create-own",
        serviceId: ownForm.id ?? undefined,
        name: ownForm.name.trim(),
        description: ownForm.description.trim(),
        price: ownForm.price,
        durationMinutes: ownForm.durationMinutes,
      }),
    });
    setOwnForm(null);
    await loadServices(myId);
    setSaving(false);
    setSvcSaved(true);
    setTimeout(() => setSvcSaved(false), 2000);
  }

  async function deleteOwnService(serviceId: string) {
    if (!myId) return;
    if (!confirm("למחוק שירות זה?")) return;
    setSaving(true);
    const res = await fetch(`/api/admin/staff/${myId}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete-own", serviceId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "מחיקה נכשלה");
    }
    await loadServices(myId);
    setSaving(false);
  }

  return (
    <div className="p-6 sm:p-8 overflow-auto h-full">
      <Link href="/admin/barber-settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות שלי</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🛠️ השירותים שלי</h1>
        <p className="text-neutral-500 text-sm mt-1">בחר אילו שירותים אתה מציע. ניתן לקבוע מחיר ומשך מותאמים.</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-3 max-w-2xl">
          {svcSaved && <div className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">✓ נשמר</div>}
          {services.length === 0 && (
            <div className="text-sm text-neutral-400 text-center py-10 bg-white rounded-2xl border border-neutral-100">
              אין שירותים זמינים
            </div>
          )}

          {services.filter(s => !s.owned).map(svc => (
            <div key={svc.id} className={`bg-white rounded-2xl border p-4 ${svc.enabled ? "border-teal-200" : "border-neutral-100"}`}>
              <div className="flex items-center gap-3">
                <button onClick={() => toggleService(svc.id, !svc.enabled)} disabled={saving}
                  className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${svc.enabled ? "bg-teal-600" : "bg-neutral-300"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${svc.enabled ? "right-0.5" : "left-0.5"}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-neutral-900 text-sm">
                    {svc.customName || svc.name}
                    {svc.customName && <span className="text-neutral-400 font-normal"> ({svc.name})</span>}
                  </div>
                  <div className="text-xs text-neutral-400">
                    {svc.customPrice != null ? `₪${svc.customPrice}` : `₪${svc.price}`}
                    {" · "}
                    {svc.customDuration != null ? `${svc.customDuration} דק'` : `${svc.durationMinutes} דק'`}
                    {(svc.customPrice != null || svc.customDuration != null || svc.customName || svc.customDescription || svc.customNote) && <span className="text-teal-600"> (מותאם)</span>}
                  </div>
                  {svc.customDescription && <div className="text-xs text-neutral-400 mt-0.5 truncate">{svc.customDescription}</div>}
                  {svc.customNote && <div className="text-xs text-neutral-400 mt-0.5 truncate">📝 {svc.customNote}</div>}
                </div>
                {svc.enabled && (
                  <button onClick={() => {
                    setEditingSvc(svc.id);
                    setCustomPrice(svc.customPrice != null ? String(svc.customPrice) : "");
                    setCustomDuration(svc.customDuration != null ? String(svc.customDuration) : "");
                    setCustomName(svc.customName ?? "");
                    setCustomDescription(svc.customDescription ?? "");
                    setCustomNote(svc.customNote ?? "");
                  }}
                    className="text-xs text-neutral-500 hover:text-teal-700 px-2 py-1 rounded-lg border border-neutral-200 hover:border-teal-300 transition">
                    ✏️ התאם
                  </button>
                )}
              </div>
              {editingSvc === svc.id && (
                <div className="mt-3 pt-3 border-t border-neutral-100 space-y-3">
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">שם מותאם</label>
                    <input type="text" value={customName}
                      onChange={e => setCustomName(e.target.value)}
                      placeholder={`${svc.name} (ברירת מחדל)`}
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">תיאור מותאם</label>
                    <textarea value={customDescription} rows={2}
                      onChange={e => setCustomDescription(e.target.value)}
                      placeholder={svc.description ? `${svc.description} (ברירת מחדל)` : "תיאור השירות שיוצג ללקוח (אופציונלי)"}
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">הערה אישית</label>
                    <textarea value={customNote} rows={2}
                      onChange={e => setCustomNote(e.target.value)}
                      placeholder="הערה אישית שתוצג ללקוח (אופציונלי)"
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">מחיר מותאם (₪)</label>
                      <input type="number" min={0} value={customPrice} onChange={e => setCustomPrice(e.target.value)}
                        placeholder={`${svc.price} (ברירת מחדל)`}
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">משך מותאם (דקות)</label>
                      <input type="number" min={5} step={5} value={customDuration} onChange={e => setCustomDuration(e.target.value)}
                        placeholder={`${svc.durationMinutes} (ברירת מחדל)`}
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveCustom(svc.id)} disabled={saving}
                      className="flex-1 bg-teal-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                      {saving ? "שומר..." : "שמור"}
                    </button>
                    <button onClick={() => setEditingSvc(null)}
                      className="px-4 bg-neutral-100 text-neutral-600 py-2 rounded-xl text-sm">ביטול</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Own services — the barber's private services (independent of the owner) */}
          {(canManageOwn || services.some(s => s.owned)) && (
            <div className="pt-4 mt-2 border-t border-neutral-100">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-neutral-800">השירותים האישיים שלי</p>
                  <p className="text-xs text-neutral-400 mt-0.5">שירותים אישיים שלך, ללא תלות בשירותי המנהל</p>
                </div>
                {canManageOwn && (
                  <button
                    onClick={() => setOwnForm({ id: null, name: "", description: "", price: "", durationMinutes: "30" })}
                    className="bg-teal-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-teal-700 transition shrink-0">
                    + שירות חדש
                  </button>
                )}
              </div>

              {!canManageOwn && (
                <p className="text-xs text-neutral-400 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2 mb-3">
                  ניהול שירותים אישי מושבת. ניתן להפעיל אותו דרך המנהל הראשי.
                </p>
              )}

              {ownForm && (
                <div className="bg-white rounded-2xl border border-teal-200 p-4 mb-3 space-y-3">
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">שם השירות *</label>
                    <input value={ownForm.name}
                      onChange={e => setOwnForm(p => p && ({ ...p, name: e.target.value }))}
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">תיאור</label>
                    <input value={ownForm.description}
                      onChange={e => setOwnForm(p => p && ({ ...p, description: e.target.value }))}
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">מחיר (₪) *</label>
                      <input type="number" min={0} value={ownForm.price} dir="ltr"
                        onChange={e => setOwnForm(p => p && ({ ...p, price: e.target.value }))}
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">משך (דקות) *</label>
                      <input type="number" min={5} step={5} value={ownForm.durationMinutes} dir="ltr"
                        onChange={e => setOwnForm(p => p && ({ ...p, durationMinutes: e.target.value }))}
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveOwnService} disabled={saving || !ownForm.name.trim() || !ownForm.price || !ownForm.durationMinutes}
                      className="flex-1 bg-teal-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition">
                      {saving ? "שומר..." : "שמור"}
                    </button>
                    <button onClick={() => setOwnForm(null)}
                      className="px-4 bg-neutral-100 text-neutral-600 py-2 rounded-xl text-sm transition hover:bg-neutral-200">
                      ביטול
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {services.filter(s => s.owned).map(svc => (
                  <div key={svc.id} className="bg-white rounded-2xl border border-neutral-200 p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-neutral-900 text-sm">{svc.name}</span>
                        <span className="text-[10px] bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded-full font-medium">שלי</span>
                      </div>
                      {svc.description && <div className="text-xs text-neutral-400 mt-0.5 truncate">{svc.description}</div>}
                      <div className="text-xs text-neutral-400 mt-0.5">₪{svc.price} · {svc.durationMinutes} דק&apos;</div>
                    </div>
                    {canManageOwn && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => setOwnForm({ id: svc.id, name: svc.name, description: svc.description ?? "", price: String(svc.price), durationMinutes: String(svc.durationMinutes) })}
                          className="text-xs text-neutral-500 hover:text-teal-700 px-2 py-1 rounded-lg border border-neutral-200 hover:border-teal-300 transition">
                          ✏️ ערוך
                        </button>
                        <button onClick={() => deleteOwnService(svc.id)}
                          className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg border border-neutral-200 hover:border-red-200 transition">
                          מחק
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {services.filter(s => s.owned).length === 0 && canManageOwn && (
                  <p className="text-xs text-neutral-300 text-center py-4">עדיין לא הוספת שירותים אישיים</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
