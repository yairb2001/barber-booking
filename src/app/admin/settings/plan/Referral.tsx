"use client";

import { useState } from "react";
import { shortDate, type PlanData } from "./shared";

/**
 * "חבר מביא חבר" on the owner's plan screen (11.10.2026): his personal link,
 * a WhatsApp share, and who joined through it. Same rule everywhere: a free
 * month for every shop that starts paying (src/lib/referral.ts).
 */
export default function Referral({ r }: { r: PlanData["referral"] }) {
  const [copied, setCopied] = useState(false);
  const share = `היי, אני עובד עם צ'אטור. סוכן שעונה ללקוחות בוואטסאפ של המספרה וקובע להם תורים לבד. החודש הראשון חינם, שווה לך לנסות: ${r.link}`;
  async function copy() {
    try { await navigator.clipboard.writeText(r.link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt("להעתקה:", r.link); }
  }
  const waiting = r.earned - r.applied;
  return (
    <section id="referral" className="bg-white rounded-2xl border border-teal-200 p-5 scroll-mt-4">
      <h2 className="font-semibold text-neutral-800">חבר מביא חבר</h2>
      <p className="text-sm text-neutral-600 mt-1 leading-relaxed">מכיר בעל מספרה שזה יעזור לו? שלח לו את הקישור שלך. <b>על כל מספרה שתביא, כשהיא מתחילה לשלם, אתה מקבל חודש חינם.</b></p>
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
        <span className="flex-1 min-w-0 truncate text-sm text-neutral-700" dir="ltr">{r.link}</span>
        <button type="button" onClick={() => void copy()} className="shrink-0 text-sm font-semibold text-teal-700">{copied ? "הועתק" : "העתק"}</button>
      </div>
      <a href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-[#25D366] text-white text-sm font-semibold py-2.5 hover:opacity-90 transition">
        לשלוח לחבר בוואטסאפ
      </a>
      <p className="text-[11px] text-neutral-500 mt-2">חבר שכבר שמע עליך יכול גם לכתוב את הנייד שלך בהרשמה, בשורה &quot;מישהו המליץ לך עלינו?&quot;.</p>
      {r.friends.length > 0 && (
        <div className="mt-4">
          <p className="text-sm text-neutral-700">
            הצטרפו דרכך: <b className="tabular-nums">{r.friends.length}</b> · חודשים חינם שהרווחת: <b className="tabular-nums">{r.earned}</b>
            {waiting > 0 && <span className="text-xs text-teal-700"> ({waiting === 1 ? "חודש אחד יירד" : `${waiting} חודשים יירדו`} מהחיובים הבאים)</span>}
          </p>
          <div className="mt-2 divide-y divide-neutral-100 rounded-xl border border-neutral-200">
            {r.friends.map((f, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-neutral-800">{f.name}</span>
                <span className="shrink-0 text-xs text-neutral-500">{f.paying ? <span className="font-semibold text-emerald-700">התחילו לשלם, קיבלת חודש</span> : `נרשמו ב־${shortDate(f.at)}, עדיין בחודש החינם`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
