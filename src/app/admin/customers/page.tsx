"use client";
import { insightsSummaryLine, usualLine, type CustomerInsights } from "@/lib/customer-insights";

import { useEffect, useState } from "react";
import { telHref } from "@/lib/messaging/phone";
import { useModalBack } from "@/lib/useModalBack";
import { useRouter } from "next/navigation";

type Customer = {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  isBlocked: boolean;
  messagingOptOut: boolean;
  referralSource?: string | null;
  notificationPrefs?: string | null;
  notes?: string | null;
  lastVisitAt?: string | null;
  // From ?stats=1
  visits?: number;
  lastVisit?: string | null;
  nextAppt?: { date: string; startTime: string } | null;
  noShows?: number;
};

type ListFilter = "all" | "no_future" | "inactive" | "new" | "no_shows" | "mine";
type ListSort = "name" | "last_visit" | "visits";
const FILTER_CHIPS: { key: ListFilter; label: string; hint: string }[] = [
  { key: "all",       label: "הכל",              hint: "" },
  { key: "no_future", label: "בלי תור עתידי",    hint: "לקוחות שאין להם תור קרוב — הכי שווה לשלוח להם" },
  { key: "inactive",  label: "לא היו 6+ שבועות", hint: "לא ביקרו 42 יום ומעלה" },
  { key: "new",       label: "חדשים החודש",       hint: "הצטרפו ב-30 הימים האחרונים" },
  { key: "no_shows",  label: "הבריזו",            hint: "לקוחות שסומנו כלא הגיעו" },
  { key: "mine",      label: "רק שלי",            hint: "לקוחות שהיו אצלי" },
];
function filterQuery(filter: ListFilter, sort: ListSort, myStaffId: string | null): string {
  const p = new URLSearchParams({ limit: "2000", stats: "1", sort });
  if (filter === "no_future") p.set("no_future", "1");
  if (filter === "inactive") p.set("inactive_days", "42");
  if (filter === "new") p.set("new_days", "30");
  if (filter === "no_shows") p.set("no_shows", "1");
  if (filter === "mine" && myStaffId) p.set("staffId", myStaffId);
  return p.toString();
}
type DupGroup = { phone: string; customers: { id: string; name: string; phone: string; createdAt: string; notes: string | null; visits: number }[] };
function DupRow({ group, onMerged }: { group: DupGroup; onMerged: () => void }) {
  const [keepId, setKeepId] = useState(group.customers[0]?.id || "");
  const [busy, setBusy] = useState(false);
  async function merge() {
    setBusy(true);
    const r = await fetch("/api/admin/customers/duplicates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepId, mergeIds: group.customers.filter(c => c.id !== keepId).map(c => c.id) }),
    });
    setBusy(false);
    if (r.ok) onMerged();
  }
  return (
    <li className="bg-white border border-amber-100 rounded-xl p-3">
      <div className="flex flex-wrap gap-2 items-center">
        {group.customers.map(c => (
          <label key={c.id} className={`flex items-center gap-2 text-xs rounded-lg border px-2.5 py-1.5 cursor-pointer ${keepId === c.id ? "border-teal-500 bg-teal-50" : "border-neutral-200"}`}>
            <input type="radio" name={`keep-${group.phone}`} checked={keepId === c.id} onChange={() => setKeepId(c.id)} />
            <span className="font-medium">{c.name}</span>
            <span className="text-neutral-400" dir="ltr">{c.phone}</span>
            <span className="text-neutral-500">· {c.visits} תורים</span>
          </label>
        ))}
        <button onClick={merge} disabled={busy} className="mr-auto px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-600 text-white disabled:opacity-50">
          {busy ? "ממזג…" : "מזג לנבחר"}
        </button>
      </div>
    </li>
  );
}
function daysAgoLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86_400_000);
  if (d <= 0) return "היום";
  if (d === 1) return "אתמול";
  if (d < 7) return `לפני ${d} ימים`;
  if (d < 60) return `לפני ${Math.round(d / 7)} שבועות`;
  return `לפני ${Math.round(d / 30)} חודשים`;
}

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
  insights?: CustomerInsights | null;
  referrals: ReferralInfo[];
  rewards: Rewards;
  blockedStaffIds: string[];
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<{ id: string; name: string } | null>(null);
  const [filter, setFilter] = useState<ListFilter>("all");
  const [sort, setSort] = useState<ListSort>("name");
  const [myStaffId, setMyStaffId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [dupGroups, setDupGroups] = useState<DupGroup[] | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  useEffect(() => {
    fetch("/api/admin/me").then(r => (r.ok ? r.json() : null)).then(d => {
      setMyStaffId(d?.staffId || null);
      setIsOwner(!!d?.isOwner);
      if (d?.isOwner) fetch("/api/admin/customers/duplicates").then(r => (r.ok ? r.json() : [])).then(g => setDupGroups(Array.isArray(g) ? g : [])).catch(() => {});
    }).catch(() => {});
  }, []);

  const reload = () => {
    setLoading(true);
    fetch(`/api/admin/customers?${filterQuery(filter, sort, myStaffId)}&q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(d => { setCustomers(Array.isArray(d) ? d : []); setLoading(false); });
  };

  useEffect(() => {
    const t = setTimeout(reload, 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filter, sort, myStaffId]);

  // Deep-link: /admin/customers?customer=<phone> opens that customer's card
  // (used by the WhatsApp inbox "open customer card" link).
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("customer");
    if (p) setPendingPhone(p);
  }, []);
  useEffect(() => {
    if (!pendingPhone || customers.length === 0) return;
    const norm = (x: string) => (x || "").replace(/\D/g, "").replace(/^0/, "972");
    // Accepts a phone (chat deep-link) or a customer id (dashboard links).
    const target = customers.find(c => c.id === pendingPhone || norm(c.phone) === norm(pendingPhone));
    if (target) { setSelectedId(target.id); setPendingPhone(null); }
  }, [pendingPhone, customers]);

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

      {/* Duplicate customers (same phone in two spellings) — owner only */}
      {isOwner && dupGroups && dupGroups.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">⚠ {dupGroups.length} לקוחות כפולים</p>
              <p className="text-xs text-amber-800 mt-0.5">אותו טלפון נשמר פעמיים (פעם ב-05 ופעם ב-972). המיזוג מאחד היסטוריה, הערות והפניות — לא מוחק כלום.</p>
            </div>
            <button onClick={() => setDupOpen(v => !v)} className="text-xs font-semibold text-amber-900 underline shrink-0">{dupOpen ? "סגור" : "טפל"}</button>
          </div>
          {dupOpen && (
            <ul className="mt-3 space-y-2">
              {dupGroups.map(g => (
                <DupRow key={g.phone} group={g} onMerged={() => { setDupGroups(gs => (gs || []).filter(x => x.phone !== g.phone)); reload(); }} />
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mb-3">
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="חפש לפי שם, טלפון או הערה..."
          className="w-full max-w-sm border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white" />
      </div>

      {/* Filter chips + sort + "send to this group" */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {FILTER_CHIPS.filter(c => c.key !== "mine" || myStaffId).map(c => (
          <button key={c.key} onClick={() => setFilter(c.key)} title={c.hint}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${filter === c.key ? "bg-teal-600 text-white border-teal-600" : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50"}`}>
            {c.label}
          </button>
        ))}
        <span className="mx-1 text-neutral-300">|</span>
        <select value={sort} onChange={e => setSort(e.target.value as ListSort)}
          className="text-xs border border-neutral-200 rounded-full px-3 py-1.5 bg-white text-neutral-700">
          <option value="name">מיון: שם</option>
          <option value="last_visit">מיון: ביקור אחרון</option>
          <option value="visits">מיון: מספר ביקורים</option>
        </select>
        {filter !== "all" && !loading && customers.length > 0 && (
          <a href={`/admin/messaging?fq=${encodeURIComponent(filterQuery(filter, sort, myStaffId))}&label=${encodeURIComponent(`${FILTER_CHIPS.find(c => c.key === filter)?.label} · ${customers.length} לקוחות`)}`}
            className="mr-auto px-3 py-1.5 rounded-full text-xs font-semibold bg-neutral-900 text-white hover:bg-neutral-800">
            📢 שלח הודעה ל-{customers.length}
          </a>
        )}
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
                <th className="text-right px-3 sm:px-5 py-3 text-neutral-500 font-medium">שם</th>
                <th className="text-right px-3 sm:px-5 py-3 text-neutral-500 font-medium">טלפון</th>
                <th className="text-right px-3 sm:px-5 py-3 text-neutral-500 font-medium whitespace-nowrap">ביקור אחרון</th>
                <th className="text-right px-5 py-3 text-neutral-500 font-medium hidden sm:table-cell">ביקורים</th>
                <th className="px-3 sm:px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {customers.map(c => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`hover:bg-neutral-50 cursor-pointer ${c.isBlocked ? "opacity-50" : ""}`}
                >
                  <td className="px-3 sm:px-5 py-4 font-medium text-neutral-900">
                    {c.name}
                    {c.isBlocked && <span className="mr-2 text-xs text-red-500">🚫 חסום</span>}
                    {c.messagingOptOut && <span className="mr-2 text-xs text-slate-400">🔕 לא מקבל הודעות</span>}
                  </td>
                  <td className="px-3 sm:px-5 py-4 text-neutral-600 whitespace-nowrap" dir="ltr">{c.phone}</td>
                  <td className="px-3 sm:px-5 py-4 text-xs whitespace-nowrap">
                    <span className={c.lastVisit ? "text-neutral-600" : "text-neutral-300"}>{daysAgoLabel(c.lastVisit)}</span>
                    {c.nextAppt && <span className="block text-[10px] text-teal-600">תור: {new Date(c.nextAppt.date + "T00:00:00").toLocaleDateString("he-IL", { day: "numeric", month: "numeric" })} {c.nextAppt.startTime}</span>}
                    {!!c.noShows && <span className="block text-[10px] text-neutral-500">⚠ הבריז {c.noShows}</span>}
                  </td>
                  <td className="px-5 py-4 text-neutral-500 text-xs hidden sm:table-cell">{c.visits ?? "—"}</td>
                  <td className="px-3 sm:px-5 py-4" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-2 sm:gap-3 items-center">
                      <a href={telHref(c.phone)} className="text-base text-neutral-500 hover:text-neutral-800">📞</a>
                      <button
                        onClick={() => setMessageTarget({ id: c.id, name: c.name })}
                        title="שלח הודעה דרך המערכת"
                        className="text-base text-teal-600 hover:text-teal-800">✉️</button>
                      <a href={`https://wa.me/${c.phone.replace(/\D/g,"").replace(/^0/,"972")}`} target="_blank" rel="noreferrer" className="text-base text-emerald-500 hover:text-emerald-700">💬</a>
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

      {messageTarget && (
        <SendMessageModal
          customerId={messageTarget.id}
          customerName={messageTarget.name}
          onClose={() => setMessageTarget(null)}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Send a one-off WhatsApp message to a single customer (via the system)
// ───────────────────────────────────────────────────────────
function SendMessageModal({ customerId, customerName, onClose }: {
  customerId: string;
  customerName: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  useModalBack(true, onClose);

  const send = async () => {
    setErr(null);
    if (!message.trim()) { setErr("יש להזין הודעה"); return; }
    setSending(true);
    const r = await fetch(`/api/admin/customers/${customerId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    setSending(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || "שגיאה בשליחה");
      return;
    }
    setSent(true);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-bold">שליחת הודעה</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">✕</button>
        </div>
        <p className="text-xs text-neutral-500 mb-4">אל {customerName} • דרך WhatsApp של העסק</p>

        {sent ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-sm text-neutral-700 mb-5">ההודעה נשלחה</p>
            <button onClick={onClose}
              className="w-full bg-neutral-900 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-neutral-800">
              סגור
            </button>
          </div>
        ) : (
          <>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5} autoFocus
              placeholder="כתוב את ההודעה כאן..."
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
            <p className="text-[11px] text-neutral-400 mt-1">טיפ: להדגשה עטוף טקסט בכוכביות — ‎*טקסט*</p>
            {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2 mt-2">{err}</div>}
            <div className="flex gap-2 mt-4">
              <button onClick={onClose} className="flex-1 border border-neutral-200 rounded-xl py-2.5 text-sm hover:bg-neutral-50">ביטול</button>
              <button onClick={send} disabled={sending}
                className="flex-1 bg-teal-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-teal-700 disabled:opacity-50">
                {sending ? "שולח..." : "שלח הודעה"}
              </button>
            </div>
          </>
        )}
      </div>
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
  useModalBack(true, onClose);

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
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">טלפון *</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} dir="ltr"
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">מאיפה הגיע (אופציונלי)</label>
            <input value={referralSource} onChange={e => setReferralSource(e.target.value)}
              placeholder="חבר המליץ, אינסטגרם, וכו׳"
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>
          <div>
            <label className="text-xs text-neutral-500">הערות (אופציונלי)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-teal-400" />
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
  const [staffList, setStaffList] = useState<StaffItem[]>([]);
  const [staffBlockOpen, setStaffBlockOpen] = useState(false);
  const router = useRouter();
  useModalBack(true, onClose);

  useEffect(() => {
    fetch("/api/admin/staff").then(r => r.json()).then((d: StaffItem[]) => setStaffList(d)).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    const r = await fetch(`/api/admin/customers/${id}`);
    const d = await r.json();
    setDetail(d);
    setNameDraft(d.name || "");
    setNotesDraft(d.notes || "");
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

  const toggleOptOut = async () => {
    if (!detail) return;
    const next = !detail.messagingOptOut;
    if (next && !confirm("להסיר את הלקוח מהודעות? הוא ימשיך להופיע במאגר ולקבוע תורים כרגיל, אבל לא יקבל יותר תפוצות/אוטומציות — רק תזכורות לתורים שכבר קבע. קביעת תור חדש תחזיר אותו אוטומטית.")) return;
    await patch({ messagingOptOut: next });
  };

  const toggleStaffBlock = async (staffId: string) => {
    if (!detail) return;
    const current = detail.blockedStaffIds || [];
    const next = current.includes(staffId)
      ? current.filter(x => x !== staffId)
      : [...current, staffId];
    await patch({ blockedStaffIds: next });
  };

  const remove = async () => {
    if (!confirm("למחוק את הלקוח מהמערכת? הוא ייעלם מרשימת הלקוחות, אבל היסטוריית התורים תישמר.")) return;
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

  const convertToStaff = async () => {
    if (!detail) return;
    if (!confirm(`להפוך את ${detail.name} לספר/מנהל?\n\nסיסמת ברירת מחדל: 12345678`)) return;
    setBusy(true);
    const r = await fetch("/api/admin/staff/from-customer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: id }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || "שגיאה בהמרה");
      return;
    }
    alert(`✅ ${detail.name} הפך לספר! סיסמה זמנית: 12345678`);
    onClose();
  };

  if (loading || !detail) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl p-8 text-neutral-400">טוען...</div>
      </div>
    );
  }

  const notesValue = detail.notes || "";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="p-5 border-b border-neutral-100 flex items-start justify-between sticky top-0 bg-white z-10">
          <div className="flex-1">
            {editingName ? (
              <div className="flex gap-2">
                <input value={nameDraft} onChange={e => setNameDraft(e.target.value)}
                  className="flex-1 border border-neutral-200 rounded-lg px-3 py-1.5 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-teal-400" />
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
              {detail.messagingOptOut && <span className="mr-2 text-slate-400">🔕 לא מקבל הודעות</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 text-xl ml-2">✕</button>
        </div>

        {/* "הרגיל שלו" — computed from history, nothing to type */}
        {detail.insights && (detail.insights.visits > 0) && (
          <div className="px-5 py-3 border-b border-neutral-100 bg-teal-50/60">
            <p className="text-sm font-semibold text-teal-900 leading-snug">{insightsSummaryLine(detail.insights)}</p>
            {usualLine(detail.insights) && (
              <p className="text-xs text-teal-700 mt-1">הרגיל שלו: {usualLine(detail.insights)}</p>
            )}
            {detail.insights.switchedBarber && (
              <p className="text-xs text-amber-700 mt-1">
                עבר מ{detail.insights.switchedBarber.fromName} ל{detail.insights.switchedBarber.toName} ({new Date(detail.insights.switchedBarber.sinceISO).toLocaleDateString("he-IL", { month: "short", year: "2-digit" })})
              </p>
            )}
          </div>
        )}

        {/* Quick action buttons */}
        <div className="p-5 grid grid-cols-2 gap-2 border-b border-neutral-100">
          <a href={telHref(detail.phone)}
            className="flex items-center justify-center gap-2 bg-neutral-50 hover:bg-neutral-100 rounded-xl py-3 text-sm">
            <span>📞</span> חיוג מהיר
          </a>
          <button onClick={() => setRecurringOpen(true)}
            className="flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl py-3 text-sm">
            <span>🔁</span> תור קבוע
          </button>
          <button onClick={() => router.push(`/admin/chats?phone=${encodeURIComponent(detail.phone)}${detail.name ? `&name=${encodeURIComponent(detail.name)}` : ""}`)}
            className="flex items-center justify-center gap-2 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-xl py-3 text-sm">
            <span>✉️</span> פתח שיחה במערכת
          </button>
          <a href={`https://wa.me/${detail.phone.replace(/\D/g,"").replace(/^0/,"972")}`} target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl py-3 text-sm">
            <span>💬</span> פתח ב-WhatsApp
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
              <button onClick={() => setEditingNotes(true)} className="text-xs text-slate-800 hover:underline">
                {notesValue ? "ערוך" : "הוסף מידע"}
              </button>
            )}
          </div>
          {editingNotes ? (
            <div className="space-y-2">
              <textarea value={notesDraft} onChange={e => setNotesDraft(e.target.value)} rows={3}
                placeholder="העדפות שיער, אלרגיות, הערות..."
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              <div className="flex gap-2">
                <button onClick={saveNotes} disabled={busy}
                  className="bg-neutral-900 text-white rounded-lg px-3 py-1.5 text-xs">שמור</button>
                <button onClick={() => { setEditingNotes(false); setNotesDraft(notesValue); }}
                  className="text-neutral-500 text-xs px-2">ביטול</button>
              </div>
            </div>
          ) : notesValue ? (
            <p className="text-sm text-neutral-700 bg-slate-50 border border-slate-100 rounded-xl p-3 whitespace-pre-wrap">{notesValue}</p>
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
                    className={`h-full rounded-full transition-all ${detail.rewards.productGiftEarned ? "bg-emerald-400" : "bg-slate-700"}`}
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
                    className={`h-full rounded-full transition-all ${detail.rewards.freeHaircutEarned ? "bg-emerald-400" : "bg-slate-700"}`}
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

        {/* Convert to staff — owner action */}
        <div className="px-5 pb-3">
          <button onClick={convertToStaff} disabled={busy}
            className="w-full bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200 rounded-xl py-2.5 text-sm font-medium">
            🔄 הפוך לקוח לספר / מנהל
          </button>
        </div>

        {/* Per-barber blocking — finer-grained than the full "🚫 חסום משתמש" below */}
        {staffList.length > 0 && (
          <div className="px-5 pb-3">
            <button onClick={() => setStaffBlockOpen(v => !v)}
              className="w-full flex items-center justify-between text-sm text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-xl py-2.5 px-3">
              <span>🚫 חסימה אצל ספר מסוים{(detail.blockedStaffIds?.length ?? 0) > 0 ? ` (${detail.blockedStaffIds.length})` : ""}</span>
              <span className="text-xs">{staffBlockOpen ? "▲" : "▼"}</span>
            </button>
            {staffBlockOpen && (
              <div className="mt-2 space-y-1.5 bg-white border border-slate-200 rounded-xl p-3">
                {staffList.map(s => {
                  const blocked = (detail.blockedStaffIds || []).includes(s.id);
                  return (
                    <button key={s.id} type="button" onClick={() => toggleStaffBlock(s.id)} disabled={busy}
                      className="w-full flex items-center gap-2.5 text-right">
                      <div className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${blocked ? "bg-red-500" : "bg-neutral-300"}`}>
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${blocked ? "right-0.5" : "right-4"}`} />
                      </div>
                      <span className="text-sm text-slate-700">חסום אצל {s.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Danger zone */}
        <div className="p-5 space-y-2">
          <button onClick={toggleOptOut} disabled={busy}
            className={`w-full rounded-xl py-2.5 text-sm font-medium ${
              detail.messagingOptOut
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "bg-slate-50 text-slate-700 hover:bg-slate-100"
            }`}>
            {detail.messagingOptOut ? "🔔 החזר להודעות" : "🔕 הסר מהודעות"}
          </button>
          {detail.messagingOptOut && (
            <p className="text-[11px] text-slate-400 text-center px-2">
              לא מקבל תפוצות/אוטומציות. עדיין מופיע במאגר, יכול לקבוע תור, ומקבל תזכורות לתור קיים.
              קביעת תור חדש תחזיר אותו אוטומטית.
            </p>
          )}
          <div className="flex gap-2">
          <button onClick={toggleBlock} disabled={busy}
            className={`flex-1 rounded-xl py-2.5 text-sm font-medium ${
              detail.isBlocked
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "bg-slate-50 text-slate-700 hover:bg-slate-100"
            }`}>
            {detail.isBlocked ? "🔓 בטל חסימה" : "🚫 חסום משתמש"}
          </button>
          <button onClick={remove} disabled={busy}
            className="flex-1 bg-red-50 text-red-700 hover:bg-red-100 rounded-xl py-2.5 text-sm font-medium">
            🗑 מחק משתמש
          </button>
          </div>
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
  const [frequencyWeeks, setFrequencyWeeks] = useState<1 | 2 | 3 | 4>(1);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [horizonWeeks, setHorizonWeeks] = useState(12);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  useModalBack(true, onClose);

  useEffect(() => {
    // Defaults come from the customer's own history ("הרגיל שלו"): their
    // barber, service, weekday, hour and rhythm — the barber just confirms.
    Promise.all([
      fetch("/api/admin/staff").then(r => r.json()),
      fetch("/api/admin/services").then(r => r.json()),
      fetch(`/api/admin/customers/${customerId}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([staffD, svcD, cust]: [StaffItem[], ServiceItem[], { insights?: { usual?: { staffId: string; serviceId: string; weekday: number | null; hour: string | null; prefillHour?: string | null }; avgIntervalDays?: number | null } } | null]) => {
      setAllStaff(staffD.map(s => ({ id: s.id, name: s.name })));
      setAllServices(svcD);
      const u = cust?.insights?.usual;
      setStaffId(u?.staffId && staffD.some(s => s.id === u.staffId) ? u.staffId : (staffD[0]?.id || ""));
      setServiceId(u?.serviceId && svcD.some(s => s.id === u.serviceId) ? u.serviceId : (svcD[0]?.id || ""));
      if (u?.weekday !== null && u?.weekday !== undefined) setDayOfWeek(u.weekday);
      if (u?.hour || u?.prefillHour) setStartTime((u.hour || u.prefillHour) as string);
      const avg = cust?.insights?.avgIntervalDays;
      if (typeof avg === "number" && avg > 0) {
        const w = Math.round(avg / 7);
        setFrequencyWeeks(w <= 1 ? 1 : w === 2 ? 2 : w === 3 ? 3 : 4);
      }
    }).catch(() => {});
  }, [customerId]);

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
            <p className="text-xs text-slate-800 mb-3">
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
                { v: 2, l: "שבועיים" },
                { v: 3, l: "3 שבועות" },
                { v: 4, l: "חודש" },
              ] as const).map(({ v, l }) => (
                <button key={v} onClick={() => setFrequencyWeeks(v)}
                  className={`flex-1 border rounded-xl py-2 text-xs font-medium ${
                    frequencyWeeks === v
                      ? "bg-teal-600 text-white border-teal-600"
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
