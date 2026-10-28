"use client";
/**
 * The wizard's services screen: the starter list of the business's domains,
 * by category, and next to each service who does it (28.10.2026, spec
 * "הקמה עצמית ליופי"). Everyone in the service's domain is marked; a
 * specialist service (laser, balayage) starts with nobody, so the owner says
 * who. Saved services keep their price and minutes; who does them stays
 * editable.
 */
import { C, input, num, chip, Help, Bubble } from "./ui";
import { whoOf, waitOf, type Member, type Svc } from "./model";

export default function ServicesStep({ services, setServices, members }: {
  services: Svc[]; setServices: (f: (s: Svc[]) => Svc[]) => void; members: Member[];
}) {
  const edit = (i: number, patch: Partial<Svc>) => setServices(a => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const named = members.filter(m => m.name.trim());
  return (
    <>
      <div className="space-y-2">
        {services.map((s, i) => {
          const who = whoOf(s, named);
          const askWho = named.length > 1 || s.specialist || !who.length;
          const wait = waitOf(s);
          return (
            <div key={i}>
              {s.category && s.category !== services[i - 1]?.category && <p className="text-[12px] font-semibold mt-3 mb-1.5" style={{ color: C.petrol }}>{s.category}</p>}
              <div className="rounded-2xl border border-slate-200 p-2">
                <div className="flex items-center gap-2">
                  <input value={s.name} onChange={e => edit(i, { name: e.target.value })} className={input} placeholder="שם השירות" disabled={!!s.id} aria-label="שם השירות" />
                  {!s.id ? <button type="button" onClick={() => setServices(a => a.filter((_, j) => j !== i))} className="shrink-0 w-8 text-slate-400" aria-label="מחק שירות">✕</button> : <span className="shrink-0 w-8 text-center text-emerald-500 text-sm">✓</span>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[13px] text-slate-500">
                  <input value={s.price} onChange={e => edit(i, { price: e.target.value })} className={num} type="number" inputMode="numeric" dir="ltr" disabled={!!s.id} aria-label="מחיר" />
                  <span>₪</span>
                  <input value={s.duration} onChange={e => edit(i, { duration: e.target.value })} className={`${num} ms-3`} type="number" inputMode="numeric" dir="ltr" disabled={!!s.id} aria-label="דקות" />
                  <span>דקות</span>
                  {wait > 0 && <span className="text-[12px]">· כולל {wait} דק׳ המתנה</span>}
                  <span className="ms-auto flex gap-1">
                    <button type="button" disabled={!!s.id} onClick={() => edit(i, { priceFrom: !s.priceFrom })} className="text-[11px] font-semibold px-2 py-0.5 rounded-full border disabled:cursor-default" style={s.priceFrom ? { background: C.mist, color: C.petrol, borderColor: "transparent" } : { color: "#94A3B8", borderColor: "#E2E8F0" }} aria-pressed={!!s.priceFrom}>החל מ</button>
                    {!!s.bufferAfterMin && <button type="button" disabled={!!s.id} onClick={() => edit(i, { bufferAfterMin: 0 })} className="text-[11px] font-semibold px-2 py-0.5 rounded-full disabled:cursor-default" style={{ background: C.mist, color: C.petrol }} aria-label="בלי זמן ניקוי">ניקוי {s.bufferAfterMin} דק׳{!s.id && " ✕"}</button>}
                  </span>
                </div>
                {askWho && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className={`text-[12px] ${who.length ? "text-slate-500" : "font-semibold text-amber-700"}`}>{who.length ? "אצל:" : "מי עושה את זה?"}</span>
                    {named.map(m => {
                      const on = who.includes(m.key);
                      return <button key={m.key} type="button" onClick={() => edit(i, { who: on ? who.filter(k => k !== m.key) : [...who, m.key] })} className={`${chip(on)} !py-0.5 !px-2.5 !text-[12px]`} style={on ? { background: C.petrol } : {}}>{m.name.trim()}</button>;
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => setServices(a => [...a, { name: "", price: "", duration: "30", who: null }])} className="mt-3 text-sm font-medium" style={{ color: C.petrol }}>+ שירות</button>
      <Help label="מה משנים המחיר, הדקות ו&quot;אצל&quot;?">
        <Bubble>המחיר מופיע ללקוחות בעמוד קביעת התור, והסוכן אומר אותו כששואלים. הדקות קובעות כמה זמן התור תופס ביומן. בזמן ההמתנה של צבע אפשר לקבל לקוחה אחרת. &quot;אצל&quot;: רק אצלם הסוכן והעמוד יקבעו את השירות.</Bubble>
      </Help>
    </>
  );
}
