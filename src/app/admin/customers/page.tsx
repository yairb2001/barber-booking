"use client";

import { useEffect, useState } from "react";

type Customer = {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  isBlocked: boolean;
  referralSource?: string | null;
  notificationPrefs?: string | null;
  lastVisitAt?: string | null;
};

type Appt = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  price: number;
  staff: { name: string };
  service: { name: string };
};

type ReferralInfo = {
  id: string; name: string; phone: string; createdAt: string; completedVisits: number;
};

type Rewards = {
  confirmedReferrals: number;
  totalReferrals: number;
  productGiftEarned: boolean;
  freeHaircutEarned: boolean;
  nextMilestone: { target: number; reward: string; remaining: number } | null;
};

type CustomerDetail = Customer & {
  upcoming: Appt[];
  past: Appt[];
  totalVisits: number;
  referrals: ReferralInfo[];
  rewards: Rewards;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    fetch(`/api/admin/customers?q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(d => { setCustomers(d); setLoading(false); });
  };

  useEffect(() => {
    const t = setTimeout(reload, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="p-8 overflow-auto h-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">לקוחות</h1>
          <p className="text-neutral-500 text-sm mt-1">{customers.length} לקוחות</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="bg-neutral-900 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-neutral-800 flex items-center gap-2"
        >
          <span>➕</span>
          <span>הוסף לקוח</span>
        </button>
      </div>

      <div className="mb-4">
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="חפש לפי שם או טלפון..."
          className="w-full max-w-sm border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-neutral-400">טוען...</div>
        ) : customers.length === 0 ? (
          <div className="text-center py-12 text-neutral-400">אין לקוחות</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50">
                <th className="text-right px-5 py-3 text-neutral-500 font-medium">שם</th>
                <th className="text-right px-5 py-3 text-neutral-500 font-medium">טלפון</th>
                <th className="text-right px-5 py-3 text-neutral-500 font-medium">תאריך הצטרפות</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {customers.map(c => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`hover:bg-neutral-50 cursor-pointer ${c.isBlocked ? "opacity-50" : ""}`}
                >
                  <td className="px-5 py-4 font-medium text-neutral-900">
                    {c.name}
                    {c.isBlocked && <span className="mr-2 text-xs text-red-500">🚫 חסום</span>}
                  </td>
                  <td className="px-5 py-4 text-neutral-600" dir="ltr">{c.phone}</td>
                  <td className="px-5 py-4 text-neutral-400 text-xs">
                    {new Date(c.createdAt).toLocaleDateString("he-IL")}
                  </td>
                  <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-3">
                      <a href={`tel:${c.phone}`} className="text-xs text-neutral-500 hover:text-neutral-800">📞</a>
                      <a href={`https://wa.me/${c.phone.replace(/\D/g,"")}`} target="_blank" rel="noreferrer" className="text-xs text-emerald-500 hover:text-emerald-700">💬</a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {addOpen && (
        <AddCustomerModal
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); reload(); }}
        />
      )}

      {selectedId && (
        <CustomerDetailModal
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => { reload(); }}
          onDeleted={() => { setSelectedId(null); reload(); }}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Add customer modal
// ───────────────────────────────────────────────────────────
function AddCustomerModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [referralSource, setReferralSource] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setErr(null);
    if (!name.trim() || !phone.trim()) { setErr("שם וטלפון חובה"); return; }
    setSaving(true);
    const res = await fetch("/api/admin/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, referralSource, notes }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error || "שגיאה בשמירה");
      return;
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold">הוספת לקוח חדש</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-neutral-500">שם מלא *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">טלפון *</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} dir="ltr"
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">מאיפה הגיע (אופציונלי)</label>
            <input value={referralSource} onChange={e => setReferralSource(e.target.value)}
              placeholder="חבר המליץ, אינסטגרם, וכו׳"
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">הערות (אופציונלי)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{err}</div>}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 border border-neutral-200 rounded-xl py-2.5 text-sm hover:bg-neutral-50">ביטול</button>
          <button onClick={save} disabled={saving}
            className="flex-1 bg-neutral-900 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50">
            {saving ? "שומר..." : "שמור"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Customer detail modal (view + edit + actions)
// ───────────────────────────────────────────────────────────
function CustomerDetailModal({ id, onClose, onChanged, onDeleted }: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fetch(`/api/admin/customers/${id}`);
    const d = await r.json();
    setDetail(d);
    setNameDraft(d.name || "");
    try {
      const prefs = d.notificationPrefs ? JSON.parse(d.notificationPrefs) : {};
      setNotesDraft(prefs.notes || "");
    } catch { setNotesDraft(""); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    const r = await fetch(`/api/admin/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (r.ok) { await load(); onChanged(); return true; }
    return false;
  };

  const saveName = async () => {
    if (!nameDraft.trim()) return;
    if (await patch({ name: nameDraft.trim() })) setEditingName(false);
  };

  const saveNotes = async () => {
    if (await patch({ notes: notesDraft })) setEditingNotes(false);
  };

  const toggleBlock = async () => {
    if (!detail) return;
    const next = !detail.isBlocked;
    if (next && !confirm("לחסום את הלקוח? הוא לא יוכל לקבוע תור דרך האפליקציה.")) return;
    await patch({ isBlocked: next });
  };

  const remove = async () => {
    if (!confirm("למחוק את הלקוח לצמיתות? פעולה זו לא ניתנת לשחזור.")) return;
    setBusy(true);
    const r = await fetch(`/api/admin/customers/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || "שגיאה במחיקה");
      return;
    }
    onDeleted();
  };

  if (loading || !detail) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl p-8 text-neutral-400">טוען...</div>
      </div>
    );
  }

  const notesValue = (() => {
    try {
      const p = detail.notificationPrefs ? JSON.parse(detail.notificationPrefs) : {};
      return p.notes || "";
    } catch { return ""; }
  })();

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="p-5 border-b border-neutral-100 flex items-start justify-between sticky top-0 bg-white z-10">
          <div className="flex-1">
            {editingName ? (
              <div className="flex gap-2">
                <input value={nameDraft} onChange={e => setNameDraft(e.target.value)}
                  className="flex-1 border border-neutral-200 rounded-lg px-3 py-1.5 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <button onClick={saveName} disabled={busy} className="text-xs bg-neutral-900 text-white px-3 rounded-lg">שמור</button>
                <button onClick={() => { setEditingName(false); setNameDraft(detail.name); }} className="text-xs text-neutral-500 px-2">ביטול</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold">{detail.name}</h3>
                <button onClick={() => setEditingName(true)} className="text-xs text-neutral-400 hover:text-neutral-700">✏️</button>
              </div>
            )}
            <div className="text-sm text-neutral-500 mt-1" dir="ltr">{detail.phone}</div>
            <div className="text-xs text-neutral-400 mt-1">
              {detail.totalVisits} ביקורים •
              נרשם {new Date(detail.createdAt).toLocaleDateString("he-IL")}
              {detail.isBlocked && <span className="mr-2 text-red-500">🚫 חסום</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 text-xl ml-2">✕</button>
        </div>

        {/* Quick action buttons */}
        <div className="p-5 grid grid-cols-2 gap-2 border-b border-neutral-100">
          <a href={`tel:${detail.phone}`}
            className="flex items-center justify-center gap-2 bg-neutral-50 hover:bg-neutral-100 rounded-xl py-3 text-sm">
            <span>📞</span> חיוג מהיר
          </a>
          <button onClick={() => setRecurringOpen(true)}
            className="flex items-center justify-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl py-3 text-sm">
            <span>🔁</span> תור קבוע
          </button>
          <a href={`https://wa.me/${detail.phone.replace(/\D/g,"")}`} target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl py-3 text-sm">
            <span>💬</span> הודעת WhatsApp
          </a>
        </div>

        {/* Upcoming appointments */}
        <div className="p-5 border-b border-neutral-100">
          <h4 className="text-sm font-semibold mb-3">תורים קרובים ({detail.upcoming.length})</h4>
          {detail.upcoming.length === 0 ? (
            <div className="text-xs text-neutral-400 italic">אין תורים קרובים</div>
          ) : (
            <div className="space-y-2">
              {detail.upcoming.map(a => (
                <div key={a.id} className="flex items-center justify-between bg-neutral-50 rounded-xl px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{a.service.name} • {a.staff.name}</div>
                    <div className="text-xs text-neutral-500">
                      {new Date(a.date).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}
                      {" • "}
                      <span dir="ltr">{a.startTime}</span>
                    </div>
                  </div>
                  <div className="text-xs text-neutral-500">₪{a.price}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="p-5 border-b border-neutral-100">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold">מידע על הלקוח</h4>
            {!editingNotes && (
              <button onClick={() => setEditingNotes(true)} className="text-xs text-amber-600 hover:underline">
                {notesValue ? "ערוך" : "הוסף מידע"}
              </button>
            )}
          </div>
          {editingNotes ? (
            <div className="space-y-2">
              <textarea value={notesDraft} onChange={e => setNotesDraft(e.target.value)} rows={3}
                placeholder="העדפות שיער, אלרגיות, הערות..."
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <div className="flex gap-2">
                <button onClick={saveNotes} disabled={busy}
                  className="bg-neutral-900 text-white rounded-lg px-3 py-1.5 text-xs">שמור</button>
                <button onClick={() => { setEditingNotes(false); setNotesDraft(notesValue); }}
                  className="text-neutral-500 text-xs px-2">ביטול</button>
              </div>
            </div>
          ) : notesValue ? (
            <p className="text-sm text-neutral-700 bg-amber-50 border border-amber-100 rounded-xl p-3 whitespace-pre-wrap">{notesValue}</p>
          ) : (
            <p className="text-xs text-neutral-400 italic">אין מידע נוסף</p>
          )}
        </div>

        {/* Past appointments summary */}
        {detail.past.length > 0 && (
          <div className="p-5 border-b border-neutral-100">
            <h4 className="text-sm font-semibold mb-3">היסטוריה ({detail.past.length})</h4>
            <div className="space-y-1 max-h-40 overflow-auto">
              {detail.past.slice(0, 10).map(a => (
                <div key={a.id} className="flex items-center justify-between text-xs text-neutral-500 px-2 py-1">
                  <span>
                    {new Date(a.date).toLocaleDateString("he-IL")} • {a.service.name} • {a.staff.name}
                  </span>
                  <span className={
                    a.status === "completed" ? "text-emerald-600" :
                    a.status.startsWith("cancelled") ? "text-red-500" : "text-neutral-400"
                  }>
                    {a.status === "completed" ? "✓" : a.status.startsWith("cancelled") ? "✗" : "—"}
                  </span>
                </div>
              ))}
              {detail.past.length > 10 && (
                <div className="text-xs text-neutral-400 text-center pt-2">ועוד {detail.past.length - 10}...</div>
              )}
            </div>
          </div>
        )}

        {/* Referral rewards */}
        {detail.rewards && (detail.rewards.totalReferrals > 0 || detail.rewards.confirmedReferrals > 0) && (
          <div className="p-5 border-b border-neutral-100">
            <h4 className="text-sm font-semibold mb-3">🎁 תוכנית חבר מביא חבר</h4>

            {/* Progress bar */}
            <div className="space-y-2 mb-3">
              {/* Milestone 1: 2 referrals = product */}
              <div>
                <div className="flex justify-between text-xs text-neutral-500 mb-1">
                  <span>🎁 מוצר במתנה</span>
                  <span>{Math.min(detail.rewards.confirmedReferrals, 2)}/2 חברים</span>
                </div>
                <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${detail.rewards.productGiftEarned ? "bg-emerald-400" : "bg-amber-400"}`}
                    style={{ width: `${Math.min((detail.rewards.confirmedReferrals / 2) * 100, 100)}%` }}
                  />
                </div>
                {detail.rewards.productGiftEarned && (
                  <p className="text-xs text-emerald-600 mt-1 font-medium">✅ הושג! הלקוח זכאי למוצר במתנה</p>
                )}
              </div>

              {/* Milestone 2: 3 referrals = free haircut */}
              <div>
                <div className="flex justify-between text-xs text-neutral-500 mb-1">
                  <span>✂️ תספורת חינם</span>
                  <span>{Math.min(detail.rewards.confirmedReferrals, 3)}/3 חברים</span>
                </div>
                <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${detail.rewards.freeHaircutEarned ? "bg-emerald-400" : "bg-amber-400"}`}
                    style={{ width: `${Math.min((detail.rewards.confirmedReferrals / 3) * 100, 100)}%` }}
                  />
                </div>
                {detail.rewards.freeHaircutEarned && (
                  <p className="text-xs text-emerald-600 mt-1 font-medium">✅ הושג! הלקוח זכאי לתספורת חינם</p>
                )}
              </div>
            </div>

            {/* Next milestone hint */}
            {detail.rewards.nextMilestone && (
              <p className="text-xs text-neutral-500 bg-neutral-50 rounded-lg px-3 py-2">
                עוד {detail.rewards.nextMilestone.remaining} חבר{detail.rewards.nextMilestone.remaining > 1 ? "ים" : ""} — {detail.rewards.nextMilestone.reward}
              </p>
            )}

            {/* Referred friends list */}
            {detail.referrals.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-neutral-500 mb-2">חברים שהביא ({detail.referrals.length}):</p>
                <div className="space-y-1">
                  {detail.referrals.map(r => (
                    <div key={r.id} className="flex items-center justify-between text-xs bg-neutral-50 rounded-lg px-3 py-1.5">
                      <span className="font-medium">{r.name}</span>
                      <span className={r.completedVisits > 0 ? "text-emerald-600" : "text-neutral-400"}>
                        {r.completedVisits > 0 ? `✓ ${r.completedVisits} ביקורים` : "טרם ביקר"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Danger zone */}
        <div className="p-5 flex gap-2">
          <button onClick={toggleBlock} disabled={busy}
            className={`flex-1 rounded-xl py-2.5 text-sm font-medium ${
              detail.isBlocked
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "bg-amber-50 text-amber-700 hover:bg-amber-100"
            }`}>
            {detail.isBlocked ? "🔓 בטל חסימה" : "🚫 חסום משתמש"}
          </button>
          <button onClick={remove} disabled={busy}
            className="flex-1 bg-red-50 text-red-700 hover:bg-red-100 rounded-xl py-2.5 text-sm font-medium">
            🗑 מחק משתמש
          </button>
        </div>
      </div>

      {recurringOpen && (
        <RecurringModal
          customerId={detail.id}
          customerName={detail.name}
          onClose={() => setRecurringOpen(false)}
          onSaved={() => { setRecurringOpen(false); load(); onChanged(); }}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Recurring appointment modal
// ───────────────────────────────────────────────────────────
type StaffItem = { id: string; name: string };
type ServiceItem = { id: string; name: string; price: number; durationMinutes: number };

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function RecurringModal({ customerId, customerName, onClose, onSaved }: {
  customerId: string;
  customerName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [allStaff, setAllStaff] = useState<StaffItem[]>([]);
  const [allServices, setAllServices] = useState<ServiceItem[]>([]);
  const [staffId, setStaffId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState<number>(0);
  const [startTime, setStartTime] = useState("14:00");
  const [frequencyWeeks, setFrequencyWeeks] = useState<1 | 2 | 4>(1);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [horizonWeeks, setHorizonWeeks] = useState(12);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  useEffect(() => {
    fetch("/api/admin/staff").then(r => r.json()).then((d: StaffItem[]) => {
      setAllStaff(d.map(s => ({ id: s.id, name: s.name })));
      if (d[0]) setStaffId(d[0].id);
    });
    fetch("/api/admin/services").then(r => r.json()).then((d: ServiceItem[]) => {
      setAllServices(d);
      if (d[0]) setServiceId(d[0].id);
    });
  }, []);

  const save = async () => {
    setErr(null);
    setSaving(true);
    const r = await fetch("/api/admin/recurring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId, staffId, serviceId,
        dayOfWeek, startTime,
        frequencyWeeks,
        startDate,
        horizonWeeks,
        note,
      }),
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || "שגיאה בשמירה");
      return;
    }
    const j = await r.json();
    setResult({ created: j.created, skipped: j.skipped });
  };

  if (result) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
        <div className="bg-white rounded-2xl p-6 w-full max-w-md text-center">
          <div className="text-4xl mb-3">✅</div>
          <h3 className="text-lg font-bold mb-2">תור קבוע נוצר!</h3>
          <p className="text-sm text-neutral-600 mb-1">
            נוצרו <b>{result.created}</b> תורים עבור {customerName}
          </p>
          {result.skipped > 0 && (
            <p className="text-xs text-amber-600 mb-3">
              {result.skipped} תאריכים דולגו עקב התנגשויות
            </p>
          )}
          <button onClick={onSaved}
            className="mt-4 w-full bg-neutral-900 text-white rounded-xl py-2.5 text-sm font-medium">
            סגור
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between p-5 border-b border-neutral-100">
          <div>
            <h3 className="font-bold text-lg">תור קבוע</h3>
            <p className="text-xs text-neutral-500 mt-0.5">עבור {customerName}</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-neutral-500 block mb-1">ספר</label>
            <select value={staffId} onChange={e => setStaffId(e.target.value)}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm">
              {allStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-neutral-500 block mb-1">שירות</label>
            <select value={serviceId} onChange={e => setServiceId(e.target.value)}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm">
              {allServices.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} (₪{s.price}, {s.durationMinutes} דק)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">יום בשבוע</label>
              <select value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))}
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm">
                {DAY_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">שעה</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} dir="ltr"
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="text-xs text-neutral-500 block mb-1">תדירות</label>
            <div className="flex gap-2">
              {([
                { v: 1, l: "כל שבוע" },
                { v: 2, l: "פעמיים בחודש" },
                { v: 4, l: "פעם בחודש" },
              ] as const).map(({ v, l }) => (
                <button key={v} onClick={() => setFrequencyWeeks(v)}
                  className={`flex-1 border rounded-xl py-2 text-xs font-medium ${
                    frequencyWeeks === v
                      ? "bg-amber-500 text-white border-amber-500"
                      : "bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  }`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">מתחיל ב</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} dir="ltr"
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">לכמה שבועות קדימה</label>
              <input type="number" min={1} max={52} value={horizonWeeks}
                onChange={e => setHorizonWeeks(Number(e.target.value))}
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="text-xs text-neutral-500 block mb-1">הערה (אופציונלי)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm" />
          </div>

          {err && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{err}</div>}
        </div>

        <div className="p-5 border-t border-neutral-100 flex gap-2">
          <button onClick={onClose} disabled={saving}
            className="flex-1 border border-neutral-200 rounded-xl py-2.5 text-sm hover:bg-neutral-50">ביטול</button>
          <button onClick={save} disabled={saving || !staffId || !serviceId}
            className="flex-1 bg-neutral-900 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50">
            {saving ? "יוצר..." : "צור תורים"}
          </button>
        </div>
      </div>
    </div>
  );
}
