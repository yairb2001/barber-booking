"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { C, NUM, Btn, useCrm, crmAction, ago } from "../ui";
import { AreaTabs } from "../Areas";

type Row = {
  id: string; name: string; phone: string; ig: boolean; source: string;
  stage: string; exit: string | null; exitBy: string | null;
  lastUserAt: string | null; lastAt: string | null;
  next: { when: string; text: string } | null;
  notRelevantWhen: string | null;
  waiting: boolean; academy: boolean; escalated: boolean; leadId: string | null;
};
type Data = { enabled: boolean; stages: { key: string; label: string }[]; exits: { key: string; label: string }[]; contacts: Row[] };

/** One accent per stage, light to dark along the funnel. */
const STAGE_ACCENT: Record<string, string> = { opened: "#9DD9C8", tried: C.turquoise, booked: "#2BC293", signup_link: C.petrol2 };
const SRC_TONE: Record<string, { bg: string; color: string }> = {
  "מודעה": { bg: "#FFF1D6", color: "#7A4A00" },
  "כפתור הדמו": { bg: "#E3F7EF", color: "#0F6B4F" },
  "אינסטגרם": { bg: "#FCE7F3", color: "#9D174D" },
  "רגיל": { bg: C.soft, color: "#3E5A5B" },
};

/**
 * The WhatsApp funnel (25.10.2026, Yair: "לשונית נפרדת לכל החבר'ה שפונים בוואטסאפ…
 * אני רוצה לראות כל אחד באיזה שלב הוא במשפך, ושם הכל קורה לבד"). Not leads yet: a
 * person, details or a call make them one, and they move to the leads tab.
 */
export default function WhatsappFunnelPage() {
  const { data, error, loading, reload } = useCrm<Data>("view=whatsapp");
  const [sel, setSel] = useState<string>("in");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const rows = useMemo(() => data?.contacts ?? [], [data]);
  const inFunnel = rows.filter(r => !r.exit);
  const count = (k: string) => (k === "in" ? inFunnel.length : data?.stages.some(s => s.key === k) ? inFunnel.filter(r => r.stage === k).length : rows.filter(r => (k === "not_relevant" ? r.exit === "not_relevant" || r.exit === "opted_out" : r.exit === k)).length);
  const list = sel === "in" ? inFunnel
    : data?.stages.some(s => s.key === sel) ? inFunnel.filter(r => r.stage === sel)
    : rows.filter(r => (sel === "not_relevant" ? r.exit === "not_relevant" || r.exit === "opted_out" : r.exit === sel));
  const stageName = (k: string) => data?.stages.find(s => s.key === k)?.label ?? k;
  const tabLabel = sel === "in" ? "בתוך המשפך" : stageName(sel) !== sel ? stageName(sel) : data?.exits.find(e => e.key === sel)?.label ?? "";

  async function act(id: string, body: Record<string, unknown>, done: string) {
    setBusy(id); setFlash(null);
    const r = await crmAction(body);
    setBusy(null);
    setFlash(r.ok ? done : r.error ?? "שגיאה");
    if (r.ok) { setOpen(null); await reload(); }
  }

  // Statuses are the second row under the two categories: lighter than them.
  const chip = (on: boolean) => (on ? { background: C.mist, color: C.petrol, border: `1px solid ${C.petrol2}`, fontWeight: 700 } : { background: "#fff", color: C.ink, border: "1px solid #C7D8D5" });

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2.5">
        <h1 className="m-0 text-[26px] font-extrabold">מכירות</h1>
        <AreaTabs />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm flex-[1_1_240px]" style={{ color: C.muted }}>כל מי שכתב לצ׳אטור ועוד לא ליד. הסוכן מטפל בהם וההודעות יוצאות לבד, לפי השלב.</p>
        <span className="flex items-center gap-2">
          <Link href="/admin/crm/wa-funnel" className="text-sm font-semibold min-h-[40px] inline-flex items-center px-1" style={{ color: C.petrol }}>עריכת ההודעות</Link>
          <Link href="/admin/crm/calendar" className="min-h-[40px] px-3.5 rounded-xl text-sm font-semibold inline-flex items-center" style={{ background: "#fff", color: C.petrol, border: `1px solid ${C.line}`, textDecoration: "none" }}>יומן שיחות</Link>
        </span>
      </div>

      {data && !data.enabled && (
        <p className="m-0 text-sm rounded-xl px-3.5 py-2.5" style={{ background: "#FFF1D6", color: "#7A4A00" }}>
          המשפך כבוי, אז הודעות ההמשך לא יוצאות. <Link href="/admin/crm/wa-funnel" className="font-bold underline" style={{ color: "#7A4A00" }}>להדלקה</Link>
        </p>
      )}
      {flash && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: C.mist, color: C.petrol }}>{flash}</p>}

      {/* The funnel: one tile per stage */}
      {data && (
        <section aria-label="שלבים" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {data.stages.map((s, i) => {
            const on = sel === s.key;
            return (
              <button key={s.key} type="button" aria-pressed={on} onClick={() => setSel(on ? "in" : s.key)} className="text-right rounded-2xl px-3.5 py-3 flex flex-col gap-1 min-h-[76px]" style={on ? { background: C.petrol, color: "#fff", border: `1px solid ${C.petrol}` } : { background: "#fff", color: C.ink, border: `1px solid ${C.line}` }}>
                <span className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: on ? "#CFE3DF" : C.muted }}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: STAGE_ACCENT[s.key] ?? C.petrol }} />
                  <span style={NUM}>{i + 1}</span> {s.label}
                </span>
                <span className="text-[26px] font-bold leading-none" style={NUM}>{count(s.key)}</span>
              </button>
            );
          })}
        </section>
      )}

      {/* Out of the funnel */}
      {data && (
        <div role="tablist" aria-label="יציאות" className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          {[{ key: "in", label: "כל המשפך" }, ...data.exits].map(t => (
            <button key={t.key} type="button" role="tab" aria-selected={sel === t.key} onClick={() => setSel(t.key)} className="shrink-0 h-10 px-3.5 rounded-full text-sm font-semibold inline-flex items-center gap-1.5" style={chip(sel === t.key)}>
              {t.label}<span className="text-xs" style={{ ...NUM, opacity: 0.75 }}>{count(t.key)}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-red-700">{error}</p>}
      {!data && loading && <p style={{ color: C.muted }}>טוען…</p>}
      {data && (
        <section className="bg-white rounded-2xl" style={{ border: `1px solid ${C.line}` }}>
          {list.length === 0 && <p className="m-0 p-4 text-sm" style={{ color: C.muted }}>אין אף אחד ב&quot;{tabLabel}&quot;.</p>}
          {list.slice(0, 300).map((r, i) => {
            const expanded = open === r.id;
            return (
              <div key={r.id} style={{ borderTop: i ? `1px solid ${C.soft}` : undefined }}>
                <button type="button" onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded} className="w-full text-right flex items-start gap-3 px-3.5 py-3" style={{ color: C.ink }}>
                  <span className="w-2.5 h-2.5 rounded-full mt-[7px] shrink-0" style={{ background: r.exit ? "#C7D8D5" : STAGE_ACCENT[r.stage] ?? C.petrol }} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="font-bold text-[15px] truncate">{r.name}</span>
                      {r.phone && r.name !== r.phone && <span className="text-[12px] shrink-0" dir="ltr" style={{ ...NUM, color: C.muted }}>{r.phone}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={SRC_TONE[r.source] ?? SRC_TONE["רגיל"]}>{r.source}</span>
                      {(sel === "in" || r.exit) && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: C.soft, color: C.petrol }}>{stageName(r.stage)}</span>}
                      {r.waiting && !r.exit && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#FFF1D6", color: "#7A4A00" }}>מחכה לתשובה</span>}
                      {r.academy && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#EDE9FE", color: "#5B21B6" }}>שאל על קורס</span>}
                      {r.escalated && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#FDECEA", color: "#B42318" }}>בטיפול אנושי</span>}
                      {r.exitBy && <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: C.ground, color: "#3E5A5B" }}>{r.exit === "opted_out" ? "ביקש להסיר" : r.exitBy}</span>}
                    </div>
                    {!r.exit && (
                      <p className="m-0 mt-1.5 text-[13px]" style={{ color: "#3E5A5B" }}>
                        {r.next ? <>הבא: <b style={{ color: C.petrol }}>{r.next.when}</b></> : r.notRelevantWhen ? <>בלי עוד הודעות. לא רלוונטי {r.notRelevantWhen}</> : r.academy ? "שאל על קורס, בלי הודעות המשך" : r.waiting ? "ההודעה האחרונה שלו, עוד לא ענינו" : "אין הודעה מתוזמנת"}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs mt-0.5" style={{ color: C.muted }}>{ago(r.lastUserAt ?? r.lastAt)}</span>
                </button>

                {expanded && (
                  <div className="px-3.5 pb-3.5 ps-9 flex flex-col gap-2.5">
                    {r.next && (
                      <div>
                        <p className="m-0 mb-1 text-[12px] font-semibold" style={{ color: C.muted }}>ההודעה הבאה, {r.next.when}</p>
                        <p className="m-0 text-sm whitespace-pre-line rounded-[14px] px-3 py-2.5 leading-relaxed" style={{ background: "#D9FDD3", color: C.ink }}>{r.next.text}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/admin/crm/chats/${r.id}`} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold inline-flex items-center" style={{ background: C.petrol, color: "#fff", textDecoration: "none" }}>התערב בצ׳אט</Link>
                      {r.exit === "lead" && r.leadId && <Link href={`/admin/crm/leads/${r.leadId}`} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold inline-flex items-center" style={{ background: "#fff", color: C.petrol, border: `1px solid ${C.petrol}`, textDecoration: "none" }}>לכרטיס הליד</Link>}
                      {!r.exit && <Btn disabled={busy === r.id} onClick={() => act(r.id, { action: "wa.toLead", id: r.id }, `${r.name} עבר ללידים`)}>העבר לליד</Btn>}
                      {!r.exit && <Btn kind="ghost" disabled={busy === r.id} onClick={() => act(r.id, { action: "wa.notRelevant", id: r.id, on: true }, `${r.name} סומן לא רלוונטי`)}>לא רלוונטי</Btn>}
                      <Btn kind="ghost" disabled={busy === r.id} onClick={() => confirm("להסתיר? זו שיחה אישית: היא תצא מהרשימות, בלי סוכן ובלי הודעות אוטומטיות.") && act(r.id, { action: "chat.hide", id: r.id, on: true }, `${r.name} הוסתר`)} title="שיחה אישית עם מישהו שאתה מכיר">הסתר</Btn>
                      {r.exit === "not_relevant" && r.exitBy === "סומן ידנית" && <Btn kind="ghost" disabled={busy === r.id} onClick={() => act(r.id, { action: "wa.notRelevant", id: r.id, on: false }, `${r.name} חזר למשפך`)}>החזר למשפך</Btn>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
      {data && <button type="button" onClick={() => void reload()} className="self-start text-sm min-h-[36px]" style={{ color: C.muted }}>רענון</button>}
    </div>
  );
}
