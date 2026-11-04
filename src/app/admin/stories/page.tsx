"use client";
import { useVocab } from "@/components/VocabProvider";

import Link from "next/link";
import { useEffect, useState } from "react";
import { worksKey } from "@/lib/works-shared";

type StaffOption = { id: string; name: string; avatarUrl: string | null };
type ServiceOption = { id: string; name: string; isVisible: boolean };

type Story = {
  id: string;
  mediaUrl: string;
  caption: string | null;
  isActive: boolean;
  sortOrder: number;
  serviceId: string | null;
  staff: { id: string; name: string; avatarUrl: string | null } | null;
};

/** The sheet: a new work (no id) for a treatment, or an existing one to edit. */
type Draft = { id?: string; mediaUrl: string; caption: string; staffId: string; serviceId: string; isActive: boolean };

const input = "w-full border border-neutral-200 rounded-xl px-3 h-11 text-[15px] focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white";

/**
 * The works, by treatment (skeleton approved 4.11.2026): each treatment with
 * works gets a link, the agent sends it, and the works page shows it as a tab.
 */
export default function AdminStoriesPage() {
  const v = useVocab();
  const [stories, setStories] = useState<Story[]>([]);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isOwner, setIsOwner] = useState(true);
  const [myStaffId, setMyStaffId] = useState<string | null>(null);
  const [publicPath, setPublicPath] = useState("/");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    const [storiesData, meData, staffData, servicesData] = await Promise.all([
      fetch("/api/admin/stories").then(r => r.json()),
      fetch("/api/admin/me").then(r => r.ok ? r.json() : null),
      fetch("/api/staff").then(r => r.json()).catch(() => []),
      fetch("/api/admin/services").then(r => r.json()).catch(() => []),
    ]);
    setStories(Array.isArray(storiesData) ? storiesData : []);
    if (meData) {
      setIsOwner(meData.isOwner ?? true);
      setMyStaffId(meData.staff?.id ?? null);
      if (meData.publicPath) setPublicPath(meData.publicPath);
    }
    setStaffList(Array.isArray(staffData) ? staffData : []);
    setServices(Array.isArray(servicesData) ? servicesData.filter((s: ServiceOption) => s.isVisible) : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function uploadFile(file: File) {
    setUploading(true);
    const { compressImage } = await import("@/lib/image-compress");
    const compressed = await compressImage(file, "story");
    const fd = new FormData();
    fd.append("file", compressed);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const data = await res.json();
    setUploading(false);
    if (data.url) setDraft(d => d && { ...d, mediaUrl: data.url });
    else alert(data.error || "שגיאה בהעלאת תמונה");
  }

  async function save() {
    if (!draft?.mediaUrl) return;
    setSaving(true);
    const body = { caption: draft.caption.trim() || null, serviceId: draft.serviceId || null, staffId: draft.staffId || null };
    if (draft.id) {
      await fetch(`/api/admin/stories/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, isActive: draft.isActive }) });
    } else {
      await fetch("/api/admin/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A barber's work is always his own (the API enforces it too).
        body: JSON.stringify({ ...body, mediaUrl: draft.mediaUrl, sortOrder: stories.length, staffId: isOwner ? body.staffId : myStaffId }),
      });
    }
    setDraft(null);
    setSaving(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm("למחוק את התמונה?")) return;
    await fetch(`/api/admin/stories/${id}`, { method: "DELETE" });
    setDraft(null);
    load();
  }

  // Swap with the neighbour in the same treatment's row.
  async function move(id: string, direction: -1 | 1) {
    const row = stories.filter(s => s.serviceId === stories.find(x => x.id === id)?.serviceId);
    const i = row.findIndex(s => s.id === id), j = i + direction;
    if (i < 0 || j < 0 || j >= row.length) return;
    await Promise.all([
      fetch(`/api/admin/stories/${row[i].id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sortOrder: row[j].sortOrder }) }),
      fetch(`/api/admin/stories/${row[j].id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sortOrder: row[i].sortOrder === row[j].sortOrder ? row[j].sortOrder - direction : row[i].sortOrder }) }),
    ]);
    setDraft(null);
    load();
  }

  async function copyLink(serviceId: string) {
    const url = `${window.location.origin}${publicPath === "/" ? "" : publicPath}/works?s=${worksKey(serviceId)}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(serviceId);
    setTimeout(() => setCopied(c => (c === serviceId ? null : c)), 2000);
  }

  const known = new Set(services.map(s => s.id));
  const loose = stories.filter(s => !s.serviceId || !known.has(s.serviceId));
  const openNew = (serviceId: string) => setDraft({ mediaUrl: "", caption: "", staffId: isOwner ? "" : (myStaffId ?? ""), serviceId, isActive: true });
  const openEdit = (s: Story) => isOwner && setDraft({ id: s.id, mediaUrl: s.mediaUrl, caption: s.caption ?? "", staffId: s.staff?.id ?? "", serviceId: s.serviceId ?? "", isActive: s.isActive });

  const thumbs = (list: Story[], serviceId: string | null) => (
    <div className="flex gap-2 mt-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
      {list.map(s => (
        <button key={s.id} type="button" onClick={() => openEdit(s)} aria-label={s.caption || "עבודה"}
          className={`relative w-[72px] h-[88px] shrink-0 rounded-xl overflow-hidden bg-stone-100 ${s.isActive ? "" : "opacity-40"}`}>
          <img src={s.mediaUrl} alt="" className="w-full h-full object-cover" />
        </button>
      ))}
      {serviceId && (
        <button type="button" onClick={() => openNew(serviceId)} aria-label="הוספת תמונה"
          className="w-[72px] h-[88px] shrink-0 rounded-xl border-2 border-dashed border-neutral-300 text-neutral-500 text-2xl hover:bg-neutral-50 transition">+</button>
      )}
    </div>
  );

  return (
    <div className="p-4 sm:p-6 overflow-auto h-full" dir="rtl">
      <Link href="/admin/settings/storefront" className="inline-flex items-center gap-1 h-11 text-sm text-neutral-500 hover:text-neutral-800 transition-colors">
        ← הגדרות עסק
      </Link>

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-900">העבודות</h1>
        <p className="text-neutral-500 text-[15px] mt-1">כל טיפול עם עבודות מקבל קישור, והסוכן שולח אותו ללקוחות שמבקשים אותו.</p>
      </div>

      {loading ? (
        <div className="text-center py-16 text-neutral-400">טוען...</div>
      ) : (
        <div className="space-y-3 max-w-2xl">
          {loose.length > 0 && (
            <section className="bg-white rounded-2xl border border-neutral-200 p-4">
              <h2 className="font-bold text-neutral-900 text-[16px]">בלי טיפול</h2>
              <p className="text-[13px] text-neutral-500 mt-0.5">מופיעות בדף הבית ובלשונית &quot;הכל&quot;. {isOwner ? "לחיצה על תמונה כדי לבחור לה טיפול." : ""}</p>
              {thumbs(loose, null)}
            </section>
          )}
          {services.map(svc => {
            const list = stories.filter(s => s.serviceId === svc.id);
            const live = list.filter(s => s.isActive).length;
            return (
              <section key={svc.id} className="bg-white rounded-2xl border border-neutral-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-bold text-neutral-900 text-[16px] min-w-0 truncate">{svc.name}</h2>
                  {live > 0 ? (
                    <button type="button" onClick={() => copyLink(svc.id)} className="shrink-0 h-9 text-[13px] text-teal-700 font-semibold">
                      {live} {live === 1 ? "תמונה" : "תמונות"} · {copied === svc.id ? "הקישור הועתק" : "העתק קישור"}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[13px] text-neutral-400">אין עדיין</span>
                  )}
                </div>
                {thumbs(list, svc.id)}
                {live === 0 && <p className="text-[13px] text-amber-700 mt-2">אין עבודות, אז הסוכן לא ישלח קישור לטיפול הזה.</p>}
              </section>
            );
          })}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={() => setDraft(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-sm shadow-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()} dir="rtl" role="dialog" aria-modal="true" aria-label={draft.id ? "עריכת תמונה" : "הוספת תמונה"}>
            <h3 className="font-bold text-neutral-900 mb-4 text-lg">{draft.id ? "עריכת תמונה" : "הוספת תמונה"}</h3>
            <div className="space-y-3">
              {draft.mediaUrl ? (
                <div className="w-full aspect-[4/5] max-h-72 rounded-xl overflow-hidden bg-stone-100">
                  <img src={draft.mediaUrl} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <label className="flex items-center justify-center h-28 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-[15px] font-medium text-slate-700 cursor-pointer hover:bg-slate-100 transition">
                  {uploading ? "מעלה תמונה..." : "📷 בחירת תמונה מהמכשיר"}
                  <input type="file" accept="image/*" className="hidden" disabled={uploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />
                </label>
              )}

              <div>
                <label className="text-[13px] text-neutral-500 block mb-1">טיפול</label>
                <select value={draft.serviceId} onChange={e => setDraft({ ...draft, serviceId: e.target.value })} className={input}>
                  <option value="">בלי טיפול</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              {isOwner && staffList.length > 0 && (
                <div>
                  <label className="text-[13px] text-neutral-500 block mb-1">מי עשה</label>
                  <select value={draft.staffId} onChange={e => setDraft({ ...draft, staffId: e.target.value })} className={input}>
                    <option value="">בלי שיוך ל{v.staff}</option>
                    {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="text-[13px] text-neutral-500 block mb-1">שם לתמונה (לא חובה)</label>
                <input value={draft.caption} onChange={e => setDraft({ ...draft, caption: e.target.value })} className={input} placeholder="למשל: בלייאז' דבש" />
              </div>

              {draft.id && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button type="button" onClick={() => setDraft({ ...draft, isActive: !draft.isActive })}
                    className={`h-10 px-4 rounded-full border text-[14px] ${draft.isActive ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "border-neutral-200 text-neutral-500"}`}>
                    {draft.isActive ? "מוצגת" : "מוסתרת"}
                  </button>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => move(draft.id!, -1)} className="h-10 px-3 rounded-full text-[14px] text-neutral-600 hover:bg-neutral-100" aria-label="להזיז ימינה">→</button>
                    <button type="button" onClick={() => move(draft.id!, 1)} className="h-10 px-3 rounded-full text-[14px] text-neutral-600 hover:bg-neutral-100" aria-label="להזיז שמאלה">←</button>
                    <button type="button" onClick={() => remove(draft.id!)} className="h-10 px-3 rounded-full text-[14px] text-red-500 hover:bg-red-50">מחיקה</button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={save} disabled={saving || uploading || !draft.mediaUrl}
                className="flex-1 h-12 bg-teal-600 text-white rounded-xl text-[15px] font-semibold hover:bg-teal-700 disabled:opacity-50">
                {saving ? "שומר..." : "שמירה"}
              </button>
              <button onClick={() => setDraft(null)} className="flex-1 h-12 bg-neutral-100 text-neutral-700 rounded-xl text-[15px] font-medium">
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
