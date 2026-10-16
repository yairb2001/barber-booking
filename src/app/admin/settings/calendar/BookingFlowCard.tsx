"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useVocab } from "@/components/VocabProvider";

/**
 * How customers book (16.10.2026, Yair: "שיהיה אפשר לא לבחור נותן שירות אלא
 * לבחור רק שירות וזה נותן אצל מי שהכי פנוי או אצל מי שהכי מלא ... בחירה
 * בהגדרות"). Three switches, saved in settings: who picks the staff member
 * (staffChoice), the order of the booking screens (bookingOrder, only when the
 * customer picks), and the step between offered times (slotGrid). The booking
 * page, the "any" view and the agent all follow them.
 */
type Choice = "customer" | "least" | "most";
type Order = "service" | "staff";
type GridV = "legacy" | 5 | 10 | 15 | 30;

const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-full text-sm border transition text-right ${on ? "bg-teal-600 text-white border-transparent" : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"}`;

export default function BookingFlowCard() {
  const v = useVocab();
  const router = useRouter();
  const barber = v.type === "barber_men";
  const [choice, setChoice] = useState<Choice>("customer");
  const [order, setOrder] = useState<Order>(barber ? "staff" : "service");
  const [grid, setGrid] = useState<GridV>(barber ? "legacy" : 15);
  // The agent offers a complementary treatment right after a booking (16.10.2026).
  const [upsell, setUpsell] = useState<boolean>(!barber);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business").then(r => (r.ok ? r.json() : null)).then(d => {
      const s = d?.settings ?? {};
      if (s.staffChoice === "least" || s.staffChoice === "most") setChoice(s.staffChoice);
      if (s.bookingOrder === "service" || s.bookingOrder === "staff") setOrder(s.bookingOrder);
      if (s.slotGrid === "legacy" || [5, 10, 15, 30].includes(Number(s.slotGrid))) setGrid(s.slotGrid === "legacy" ? "legacy" : (Number(s.slotGrid) as GridV));
      if (typeof s.agentUpsell === "boolean") setUpsell(s.agentUpsell);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true); setSaved(false);
    const r = await fetch("/api/admin/business", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settingsPatch: { staffChoice: choice, bookingOrder: order, slotGrid: grid, agentUpsell: upsell } }),
    }).catch(() => null);
    setSaving(false);
    if (r?.ok) { setSaved(true); router.refresh(); }
  }

  if (!loaded) return null;
  const set = <T,>(f: (x: T) => void) => (x: T) => { f(x); setSaved(false); };
  const who = v.staffFem ? "מי שהכי פנויה" : "מי שהכי פנוי";
  const full = v.staffFem ? "מי שהכי מלאה" : "מי שהכי מלא";

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-6">
      <h2 className="font-semibold text-neutral-800 mb-1">איך לקוחות קובעים</h2>
      <p className="text-xs text-neutral-500 mb-4">חל על דף קביעת התור ועל הסוכן בוואטסאפ.</p>

      <label className="text-xs text-neutral-500 block mb-1.5">אצל מי?</label>
      <div className="flex flex-col gap-1.5 items-start">
        <button type="button" onClick={() => set(setChoice)("customer")} className={chip(choice === "customer")}>{v.customerFem ? "הלקוחה בוחרת" : "הלקוח בוחר"} אצל מי</button>
        <button type="button" onClick={() => set(setChoice)("least")} className={chip(choice === "least")}>המערכת משבצת אצל {who} באותו יום (מפזר את העבודה)</button>
        <button type="button" onClick={() => set(setChoice)("most")} className={chip(choice === "most")}>המערכת משבצת אצל {full} באותו יום (ממלא יום אחד לפני שפותח עוד)</button>
      </div>
      {choice !== "customer" && <p className="text-[11px] text-neutral-500 mt-1.5">{v.customerFem ? "הלקוחה בוחרת" : "הלקוח בוחר"} רק טיפול ושעה. {v.customerFem ? "מי שתבקש" : "מי שיבקש"} {v.staff} {v.staffFem ? "מסוימת" : "מסוים"} בשם בוואטסאפ, הסוכן יכבד את זה.</p>}

      {choice === "customer" && (
        <div className="mt-4">
          <label className="text-xs text-neutral-500 block mb-1.5">מה בוחרים קודם?</label>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => set(setOrder)("service")} className={chip(order === "service")}>קודם טיפול, אחר כך אצל מי</button>
            <button type="button" onClick={() => set(setOrder)("staff")} className={chip(order === "staff")}>קודם {v.staff}, אחר כך טיפול</button>
          </div>
          <p className="text-[11px] text-neutral-500 mt-1.5">כשלא כולם עושים הכל, עדיף קודם טיפול: רואים רק את מי שעושה אותו.</p>
        </div>
      )}

      <div className="mt-4">
        <label className="text-xs text-neutral-500 block mb-1.5">כל כמה זמן מוצעת שעה?</label>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => set(setGrid)("legacy")} className={chip(grid === "legacy")}>לפי אורך הטיפול</button>
          {([5, 10, 15, 30] as const).map(n => (
            <button key={n} type="button" onClick={() => set(setGrid)(n)} className={chip(grid === n)}>כל {n} דק׳</button>
          ))}
        </div>
        <p className="text-[11px] text-neutral-500 mt-1.5">בכל אפשרות מוצעת גם השעה המדויקת שבה תור קודם נגמר, כדי שלא יישארו חורים ביומן.</p>
      </div>

      <div className="mt-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={upsell} onChange={e => { setUpsell(e.target.checked); setSaved(false); }} className="accent-teal-600 w-4 h-4 mt-0.5" />
          <span className="text-sm text-neutral-700">אחרי קביעה, הסוכן מציע טיפול נוסף מיד אחרי <span className="text-neutral-500">(פעם אחת, רק אם מישהי פנויה. מה להציע אחרי כל טיפול: במסך השירותים)</span></span>
        </label>
      </div>

      <div className="flex items-center gap-3 mt-5">
        <button type="button" onClick={() => void save()} disabled={saving}
          className="bg-teal-600 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
          {saving ? "שומר..." : "שמירה"}
        </button>
        {saved && <span className="text-sm text-teal-700">נשמר ✓</span>}
      </div>
    </div>
  );
}
