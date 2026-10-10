"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { barColor, n, shortDate, type Meter, type PlanData } from "./shared";

/**
 * "המסלול שלי" (10.10.2026). A plan is a WhatsApp message quota; appointments
 * are never limited, the plan only says how many it usually fits. The owner sees his plan, this month's use, the
 * other plans, add-on packs and his invoices. Changing plan or adding a pack
 * sends a request to Chator (nothing is charged from this screen); the agent
 * meter is a percentage, never money.
 */

const PACKS = [
  { kind: "messages", title: "עוד הודעות", desc: (q: number | null) => `${n(q ?? 0)} הודעות נוספות` },
  { kind: "ai", title: "עוד שימוש לסוכן", desc: () => "כשהסוכן מתקרב לתקרה של החודש" },
  { kind: "marketing", title: "הודעות שיווק", desc: (q: number | null) => `${n(q ?? 0)} הודעות: ״הגיע הזמן לתור״, מבצעים` },
] as const;
const PACK_NAME: Record<string, string> = { messages: "הודעות", ai: "סוכן", marketing: "שיווק" };
const INV_STATUS: Record<string, [string, string]> = { paid: ["שולם", "bg-emerald-50 text-emerald-700"], unpaid: ["לתשלום", "bg-amber-50 text-amber-700"], failed: ["החיוב נכשל", "bg-red-50 text-red-700"] };

function Bar({ label, m, text }: { label: string; m: Meter | { pct: number }; text: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="text-neutral-600">{label}</span><span className="tabular-nums text-neutral-800 font-medium">{text}</span></div>
      <div className="h-2 rounded-full bg-neutral-100 mt-1.5 overflow-hidden"><div className={`h-full rounded-full ${barColor(m.pct)}`} style={{ width: `${Math.min(100, m.pct)}%` }} /></div>
    </div>
  );
}

export default function MyPlanPage() {
  const [d, setD] = useState<PlanData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/plan", { cache: "no-store" });
    if (!r.ok) { setError(r.status === 403 || r.status === 401 ? "המסך הזה פתוח רק לבעל העסק." : "לא הצלחתי לטעון"); return; }
    setD(await r.json());
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function request(key: string, body: Record<string, unknown>, question: string) {
    if (!confirm(question)) return;
    setBusy(key);
    const r = await fetch("/api/admin/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    if (r.ok) setSent(s => ({ ...s, [key]: true }));
    else alert((await r.json().catch(() => ({}))).error || "לא נשלח, נסה שוב");
  }
  const askedRecently = (key: string) => sent[key] || (!!d?.requested[key] && Date.now() - new Date(d.requested[key]).getTime() < 24 * 3600_000);

  if (error) return <div className="p-8 text-neutral-500">{error}</div>;
  if (!d) return <div className="p-8 text-center text-neutral-400">טוען...</div>;

  const plan = d.plans.find(p => p.key === d.planKey) ?? null;
  const u = d.usage;
  const monthPacks = u ? d.packs.filter(p => p.month === u.month) : [];
  // Only WhatsApp messages are limited (Yair, 10.10.2026); appointments are never capped.
  const full = u && plan ? u.messages.pct >= 100 || u.aiPct >= 100 : false;
  const near = u && plan ? u.messages.pct >= 80 || u.aiPct >= 80 : false;

  return (
    <div className="p-6 sm:p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">המסלול שלי</h1>
        <p className="text-neutral-500 text-sm mt-1">מה כלול, כמה השתמשת החודש, תוספות וחשבוניות</p>
      </div>

      <div className="max-w-3xl space-y-4">
        {/* This month */}
        <section className="bg-white rounded-2xl border border-neutral-200 p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="font-semibold text-neutral-800">{plan ? `מסלול ${plan.name}` : d.trialEndsAt ? "תקופת ניסיון" : "עוד לא נבחר מסלול"}</h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                {plan ? `${plan.priceIls} ₪ לחודש · ${n(plan.messages)} הודעות וואטסאפ` : d.trialEndsAt ? `הכל פתוח עד ${shortDate(d.trialEndsAt)}. אחרי זה בוחרים מסלול.` : "בחר מסלול מהרשימה למטה ונחזור אליך לאשר."}
              </p>
            </div>
            {u && <span className="text-[11px] text-neutral-400 shrink-0 mt-1">מתאפס ב-1 לחודש</span>}
          </div>
          {u && plan ? (
            <div className="space-y-3.5">
              <Bar label="הודעות וואטסאפ" m={u.messages} text={`${n(u.messages.used)} מתוך ${n(u.messages.cap)}`} />
              <Bar label="הסוכן" m={{ pct: u.aiPct }} text={`${u.aiPct}% מהחבילה`} />
              {(u.marketing.cap > 0 || u.marketing.used > 0) && <Bar label="הודעות שיווק" m={u.marketing} text={`${n(u.marketing.used)} מתוך ${n(u.marketing.cap)}`} />}
              <p className="text-sm text-neutral-600">תורים החודש: <b className="tabular-nums">{n(u.appts.used)}</b> <span className="text-xs text-neutral-400">(בלי הגבלה)</span></p>
              {full ? <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">נגמרו ההודעות של החודש. אפשר להוסיף חבילת הודעות או לעבור למסלול גדול יותר.</p>
                : near ? <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">מתקרב לתקרה של החודש. כדאי לשקול חבילה או מסלול גדול יותר.</p> : null}
            </div>
          ) : u ? (
            <p className="text-sm text-neutral-600 mb-1">החודש: <b className="tabular-nums">{n(u.appts.used)}</b> תורים · <b className="tabular-nums">{n(u.messages.used)}</b> הודעות</p>
          ) : null}
          {d.payUrl && (plan || d.monthlyPrice) && (
            <a href={d.payUrl} className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-teal-600 text-white px-4 py-3 hover:bg-teal-700 transition">
              <span className="text-sm font-semibold">להזנת כרטיס אשראי</span>
              <span className="text-xs text-white/80">{d.trialEndsAt ? `לפני ${shortDate(d.trialEndsAt)}, כדי שהכל ימשיך בלי הפסקה` : "חיוב חודשי, חשבונית במייל"}</span>
            </a>
          )}
        </section>

        {/* Plans */}
        <section className="bg-white rounded-2xl border border-neutral-200 p-5">
          <h2 className="font-semibold text-neutral-800 mb-1">המסלולים</h2>
          <p className="text-xs text-neutral-500 mb-4">כולם כוללים את הסוכן בוואטסאפ, תזכורות ואישורי הגעה ואפליקציה ללקוחות. התורים לא מוגבלים, רק הודעות הוואטסאפ.</p>
          <div className="grid sm:grid-cols-3 gap-2">
            {d.plans.map(p => {
              const mine = p.key === d.planKey;
              const key = `plan:${p.key}`;
              return (
                <div key={p.key} className={`rounded-xl border p-4 flex flex-col gap-1 ${mine ? "border-teal-500 bg-teal-50" : "border-neutral-200"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-neutral-800">{p.name}</span>
                    {mine && <span className="text-[11px] font-semibold text-teal-700">המסלול שלך</span>}
                  </div>
                  <span className="text-2xl font-bold text-neutral-900 tabular-nums">{p.priceIls} ₪<span className="text-xs font-normal text-neutral-500"> לחודש</span></span>
                  <span className="text-xs text-neutral-700 font-medium">{n(p.messages)} הודעות וואטסאפ בחודש</span>
                  <span className="text-xs text-neutral-500">מתאים לכ־{n(p.apptsCap)} תורים בחודש</span>
                  {!mine && (
                    askedRecently(key)
                      ? <span className="text-xs text-teal-700 mt-2">הבקשה נשלחה, נחזור אליך לאשר</span>
                      : <button type="button" disabled={!!busy} onClick={() => request(key, { kind: "plan", planKey: p.key }, `לבקש מעבר למסלול ${p.name} (${p.priceIls} ₪ לחודש)? נחזור אליך לאשר לפני שמשהו משתנה.`)}
                          className="mt-2 text-sm py-2 rounded-lg border border-teal-600 text-teal-700 hover:bg-teal-50 disabled:opacity-50">
                          {busy === key ? "שולח..." : "לעבור למסלול הזה"}
                        </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Packs */}
        <section className="bg-white rounded-2xl border border-neutral-200 p-5">
          <h2 className="font-semibold text-neutral-800 mb-1">תוספות לחודש הזה</h2>
          <p className="text-xs text-neutral-500 mb-4">אחרי שנאשר, התוספת נכנסת מיד ונספרת עד סוף החודש.</p>
          <div className="space-y-2">
            {PACKS.map(p => {
              const price = d.packPrices[p.kind];
              const key = `pack:${p.kind}`;
              return (
                <div key={p.kind} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-800">{p.title} · <span className="tabular-nums">{price.price} ₪</span></p>
                    <p className="text-xs text-neutral-500">{p.desc(price.qty)}</p>
                  </div>
                  {askedRecently(key)
                    ? <span className="text-xs text-teal-700 shrink-0">נשלח, נחזור אליך</span>
                    : <button type="button" disabled={!!busy} onClick={() => request(key, { kind: "pack", pack: p.kind }, `לבקש ${p.title} ב-${price.price} ₪ לחודש הזה?`)}
                        className="shrink-0 text-sm px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                        {busy === key ? "שולח..." : "להוסיף"}
                      </button>}
                </div>
              );
            })}
          </div>
          {monthPacks.length > 0 && (
            <p className="text-xs text-neutral-500 mt-3">נוספו החודש: {monthPacks.map(p => `${PACK_NAME[p.kind]}${p.qty ? ` ${n(p.qty)}` : ""} (${p.priceIls} ₪)`).join(" · ")}</p>
          )}
        </section>

        {/* Invoices */}
        <section className="bg-white rounded-2xl border border-neutral-200 p-5">
          <h2 className="font-semibold text-neutral-800 mb-3">חשבוניות</h2>
          {d.invoices.length === 0 ? <p className="text-sm text-neutral-500">עדיין אין חשבוניות.</p> : (
            <div className="divide-y divide-neutral-100">
              {d.invoices.map(i => {
                const [lbl, cls] = INV_STATUS[i.status] ?? INV_STATUS.paid;
                return (
                  <div key={i.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="flex-1 min-w-0 text-neutral-700"><span className="tabular-nums">{shortDate(i.issuedAt)}</span>{i.number ? <span className="text-neutral-400"> · #{i.number}</span> : null}</span>
                    <span className="tabular-nums font-medium">{n(i.amountIls)} ₪</span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{lbl}</span>
                    {i.pdfUrl ? <a href={i.pdfUrl} target="_blank" rel="noreferrer" className="text-teal-700 underline text-sm shrink-0">פתח</a> : <span className="w-7" />}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
