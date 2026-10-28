"use client";
/**
 * The wizard's team screen (28.10.2026, spec "הקמה עצמית ליופי"): for each
 * person her name and phone, whether she is a man or a woman (or not saying),
 * what she does when the business has several domains, and her days. What she
 * does picks her services on the next screen.
 */
import { DOMAINS, type Domain } from "@/lib/domains";
import type { Vocab } from "@/lib/vocab";
import { C, input, chip, Help, Bubble } from "./ui";
import { newMember, type Member, type Gender } from "./model";

const DAY_LETTERS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const GENDERS: [Exclude<Gender, "">, string][] = [["f", "אישה"], ["m", "גבר"], ["x", "לא לציין"]];

export default function TeamStep({ members, setMembers, domains, vocab, openDays }: {
  members: Member[]; setMembers: (f: (m: Member[]) => Member[]) => void; domains: Domain[]; vocab: Vocab; openDays: boolean[];
}) {
  const edit = (i: number, patch: Partial<Member>) => setMembers(a => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const several = domains.length > 1;
  return (
    <>
      <div className="space-y-3">
        {members.map((m, i) => {
          const gender = m.gender || (several ? "" : vocab.staffFem ? "f" : "m");
          return (
            <div key={m.key} className="rounded-2xl border border-slate-200 p-3">
              <div className="flex gap-2">
                <input value={m.name} onChange={e => edit(i, { name: e.target.value })} className={input} placeholder={i === 0 ? "השם שלך" : "שם"} disabled={!!m.id} aria-label="שם" />
                <input value={m.phone} onChange={e => edit(i, { phone: e.target.value })} className={input} dir="ltr" placeholder={i === 0 ? "הנייד שלך" : "נייד"} inputMode="tel" disabled={!!m.id} aria-label="נייד" />
                {!m.id && members.length > 1 && <button type="button" onClick={() => setMembers(a => a.filter((_, j) => j !== i))} className="text-slate-400 px-1" aria-label="הסר">✕</button>}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {GENDERS.map(([g, label]) => (
                  <button key={g} type="button" onClick={() => edit(i, { gender: g })} className={chip(gender === g)} style={gender === g ? { background: C.petrol } : {}}>{label}</button>
                ))}
              </div>
              {several && (
                <div className="mt-2">
                  <p className="text-[12px] text-slate-500 mb-1">מה עושה?</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DOMAINS.filter(d => domains.includes(d.id)).map(d => {
                      const on = m.domains.includes(d.id);
                      return <button key={d.id} type="button" onClick={() => edit(i, { domains: on ? m.domains.filter(x => x !== d.id) : [...m.domains, d.id] })} className={chip(on)} style={on ? { background: C.petrol } : {}}>{d.label}</button>;
                    })}
                  </div>
                </div>
              )}
              <div className="mt-2">
                <p className="text-[12px] text-slate-500 mb-1">ימי עבודה</p>
                <div className="flex gap-1">
                  {DAY_LETTERS.map((d, k) => {
                    const on = openDays[k] && m.days[k];
                    return (
                      <button key={d} type="button" disabled={!openDays[k]} onClick={() => edit(i, { days: m.days.map((x, j) => (j === k ? !x : x)), daysEdited: true })}
                        className={`w-9 h-8 rounded-lg text-[13px] border transition disabled:opacity-30 ${on ? "text-white border-transparent" : "bg-white border-slate-200 text-slate-600"}`} style={on ? { background: C.petrol } : {}} aria-pressed={on}>{d}</button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => setMembers(a => [...a, newMember(domains, openDays)])} className="mt-3 text-sm font-medium" style={{ color: C.petrol }}>+ עוד {vocab.staff}</button>
      <Help label="למה צריך את כל זה?">
        <Bubble>הנייד האישי של כל אחד, לא של העסק: אליו מגיעות ההתראות, ואיתו נכנסים ליומן. אישה או גבר: כדי שהסוכן יגיד &quot;היא פנויה&quot; או &quot;הוא פנוי&quot;. לא לציין: הסוכן אומר רק את השם.{several ? " מה עושה: ככה הסוכן קובע לק ג'ל רק אצל מי שעושה ציפורניים." : ""} את השעות המדויקות של כל אחד אפשר לדייק אחר כך.</Bubble>
      </Help>
    </>
  );
}
