"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BUSINESS_TYPES, isBusinessType, vocabFor, type BusinessType } from "@/lib/vocab";

/**
 * The kind of business and its own words (16.10.2026, Yair: "שדה בהגדרות שבו
 * בעל העסק משנה את המילה"). The type sets the words; an owner who says
 * "מעצבות שיער" rather than "ספריות" writes her own, and both genders (the
 * team's, and how customers are addressed) can be switched. Empty = the type's
 * word. Saved into settings.vocab, which every screen, message and the agent read.
 */
type Words = { staff?: string; staffPlural?: string; staffFem?: boolean; customerFem?: boolean };

const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-full text-sm border transition ${on ? "bg-teal-600 text-white border-transparent" : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"}`;

export default function TypeAndWords() {
  const router = useRouter();
  const [type, setType] = useState<BusinessType | null>(null);
  const [savedType, setSavedType] = useState<BusinessType | null>(null);
  const [staff, setStaff] = useState("");
  const [staffPlural, setStaffPlural] = useState("");
  const [staffFem, setStaffFem] = useState<boolean | null>(null);
  const [customerFem, setCustomerFem] = useState<boolean | null>(null);
  const [otherWords, setOtherWords] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business").then(r => (r.ok ? r.json() : null)).then(d => {
      if (!d) return;
      const t = isBusinessType(d.businessType) ? d.businessType : "barber_men";
      setType(t); setSavedType(t);
      const w = (d.settings?.vocab && typeof d.settings.vocab === "object" ? d.settings.vocab : {}) as Record<string, unknown>;
      setStaff(typeof w.staff === "string" ? w.staff : "");
      setStaffPlural(typeof w.staffPlural === "string" ? w.staffPlural : "");
      setStaffFem(typeof w.staffFem === "boolean" ? w.staffFem : null);
      setCustomerFem(typeof w.customerFem === "boolean" ? w.customerFem : null);
      // Words this card doesn't edit stay as they are.
      const { staff: _a, staffPlural: _b, staffFem: _c, customerFem: _d, staffDef: _e, staffPluralDef: _f, ...rest } = w;
      void _a; void _b; void _c; void _d; void _e; void _f;
      setOtherWords(rest);
    }).catch(() => {});
  }, []);

  if (!type) return null;
  const base = vocabFor(type);
  const sFem = staffFem ?? base.staffFem;
  const cFem = customerFem ?? base.customerFem;
  // Only what differs from the type is stored, so a type change later still brings its own words.
  const words: Words = {
    ...(staff.trim() ? { staff: staff.trim() } : {}),
    ...(staffPlural.trim() ? { staffPlural: staffPlural.trim() } : {}),
    ...(sFem !== base.staffFem ? { staffFem: sFem } : {}),
    ...(cFem !== base.customerFem ? { customerFem: cFem } : {}),
  };
  const v = vocabFor(type, words);

  async function save() {
    setSaving(true); setSaved(false);
    const r = await fetch("/api/admin/business", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessType: type, settingsPatch: { vocab: { ...otherWords, ...words } } }),
    }).catch(() => null);
    setSaving(false);
    if (r?.ok) { setSaved(true); setSavedType(type); router.refresh(); }
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-6">
      <h2 className="font-semibold text-neutral-800 mb-1">סוג העסק והמילים</h2>
      <p className="text-xs text-neutral-500 mb-4">המילים שמופיעות ללקוחות בדף קביעת התור, בהודעות ובסוכן.</p>

      <label className="text-xs text-neutral-500 block mb-1.5">סוג העסק</label>
      <div className="flex flex-wrap gap-1.5 mb-1">
        {BUSINESS_TYPES.map(t => (
          <button key={t.id} type="button" onClick={() => { setType(t.id); setSaved(false); }} className={chip(type === t.id)}>{t.label}</button>
        ))}
      </div>
      {type !== savedType && <p className="text-[11px] text-amber-700 mb-1">השירותים שכבר קיימים לא משתנים, רק המילים וסדר הקביעה.</p>}

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <label className="text-xs text-neutral-500 block mb-1">איך קוראים {sFem ? "לאחת" : "לאחד"} מהצוות?</label>
          <input value={staff} onChange={e => { setStaff(e.target.value); setSaved(false); }} placeholder={base.staff}
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block mb-1">וביחד?</label>
          <input value={staffPlural} onChange={e => { setStaffPlural(e.target.value); setSaved(false); }} placeholder={base.staffPlural}
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="text-xs text-neutral-500 block mb-1.5">הצוות הוא בעיקר</label>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => { setStaffFem(false); setSaved(false); }} className={chip(!sFem)}>גברים</button>
            <button type="button" onClick={() => { setStaffFem(true); setSaved(false); }} className={chip(sFem)}>נשים</button>
          </div>
        </div>
        <div>
          <label className="text-xs text-neutral-500 block mb-1.5">פונים ללקוחות</label>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => { setCustomerFem(false); setSaved(false); }} className={chip(!cFem)}>בלשון זכר (קבע תור)</button>
            <button type="button" onClick={() => { setCustomerFem(true); setSaved(false); }} className={chip(cFem)}>בלשון נקבה (קבעי תור)</button>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-neutral-50 border border-neutral-100 px-3 py-2.5 text-sm text-neutral-700 leading-relaxed">
        <span className="text-xs text-neutral-400 block mb-0.5">כך זה ייראה</span>
        &quot;{v.staffPluralDef} שלנו&quot; · &quot;{v.choose} {v.staff}&quot; · &quot;{v.staffDef} {v.free}&quot; · &quot;{v.customerFem ? "קבעי" : "קבע"} תור {v.emoji}&quot;
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button type="button" onClick={() => void save()} disabled={saving}
          className="bg-teal-600 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
          {saving ? "שומר..." : "שמירה"}
        </button>
        {saved && <span className="text-sm text-teal-700">נשמר ✓</span>}
      </div>
    </div>
  );
}
