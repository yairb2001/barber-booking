"use client";

import { useState } from "react";
import { shortDate, type PlanData } from "./shared";
import { useVocab } from "@/components/VocabProvider";

/**
 * "חבר מביא חבר" on the owner's plan screen (11.10.2026): his personal link,
 * a WhatsApp share, and who joined through it. Same rule everywhere: a free
 * month for every shop that starts paying (src/lib/referral.ts).
 */
export default function Referral({ r }: { r: PlanData["referral"] }) {
  // A salon or clinic owner brings "עסק", a barber brings "מספרה".
  const barber = useVocab().place === "מספרה";
  const [copied, setCopied] = useState<string | null>(null);
  const place = barber ? "המספרה" : "העסק";
  // Two links (owner, 16.10.2026): a page that explains and sells, or straight
  // to signing up. Both carry his ref, so the free month is his either way.
  const links = [
    ...(r.pageLink ? [{ key: "page", title: "דף הסבר", desc: "מה זה, איך זה נראה מבפנים, מחיר ושאלות", url: r.pageLink,
      share: `היי, אני עובד עם צ'אטור. סוכן שעונה ללקוחות בוואטסאפ של ${place} וקובע להם תורים לבד. תסתכל איך זה עובד, החודש הראשון חינם: ${r.pageLink}` }] : []),
    { key: "signup", title: "הרשמה ישירה", desc: "ישר להקמה, כמה דקות", url: r.link,
      share: `היי, אני עובד עם צ'אטור. סוכן שעונה ללקוחות בוואטסאפ של ${place} וקובע להם תורים לבד. החודש הראשון חינם, אפשר להקים ישר מכאן: ${r.link}` },
  ];
  async function copy(key: string, url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(key); setTimeout(() => setCopied(null), 2000); } catch { window.prompt("להעתקה:", url); }
  }
  const waiting = r.earned - r.applied;
  return (
    <section id="referral" className="bg-white rounded-2xl border border-teal-200 p-5 scroll-mt-4">
      <h2 className="font-semibold text-neutral-800">חבר מביא חבר</h2>
      <p className="text-sm text-neutral-600 mt-1 leading-relaxed">מכיר בעל {barber ? "מספרה" : "עסק"} שזה יעזור לו? שלח לו את הקישור שלך. <b>על כל {barber ? "מספרה שתביא, כשהיא מתחילה" : "עסק שתביא, כשהוא מתחיל"} לשלם, אתה מקבל חודש חינם.</b></p>
      <div className="mt-3 space-y-3">
        {links.map(l => (
          <div key={l.key} className="rounded-xl border border-neutral-200 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-neutral-800">{l.title}</p>
              <p className="text-[11px] text-neutral-500">{l.desc}</p>
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2">
              <span className="flex-1 min-w-0 truncate text-sm text-neutral-700" dir="ltr">{l.url}</span>
              <button type="button" onClick={() => void copy(l.key, l.url)} className="shrink-0 text-sm font-semibold text-teal-700">{copied === l.key ? "הועתק" : "העתק"}</button>
            </div>
            <a href={`https://wa.me/?text=${encodeURIComponent(l.share)}`} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-[#25D366] text-white text-sm font-semibold py-2 hover:opacity-90 transition">
              לשלוח בוואטסאפ
            </a>
          </div>
        ))}
      </div>
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
