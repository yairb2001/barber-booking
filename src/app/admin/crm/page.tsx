"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { C, TONE, Tag, PageHead, useCrm, crmAction, type Tone } from "./ui";
import { CrmPushBanner } from "./CrmPush";
import { greeting } from "./HomeParts";

/**
 * CRM home = "היום" (16.10.2026, Yair picked it from the CRM review): one list
 * of what waits for him, each row with its action right there, one row per
 * person or shop. The business numbers moved to /admin/crm/numbers. Data:
 * view=today (src/app/api/admin/crm/route.ts, todayView).
 */
type Row = {
  key: string; kind: string; title: string; detail: string; time: string | null; urgent: boolean;
  href: string | null; phone: string | null; wa: string | null; also: string[];
  done: { action: string; id: string } | null; canHide: boolean;
};
type Today = { rows: Row[]; hiddenCount: number; freeSlotsToday: number };

const TAG: Record<string, [string, Tone]> = {
  call: ["שיחה", "info"], outcome: ["אחרי שיחה", "bad"], billing: ["תשלום", "bad"], chat: ["צ׳אט", "warn"],
  approve: ["סוכן", "info"], request: ["בקשה", "warn"], setup: ["הקמה", "warn"], customer: ["לקוח", "warn"],
  followup: ["לחזור", "info"], lead: ["ליד", "info"], manual: ["משימה", "ok"], calendar: ["יומן", "info"], automations: ["אוטומציות", "info"],
};
const isoDay = (d: number) => new Date(Date.now() + d * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

function TodayInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { data, error, loading, reload } = useCrm<Today>("view=today");
  // Nika (an "admin" member) is greeted by her own name.
  const { data: me } = useCrm<{ name: string; member?: boolean }>("view=whoami");
  const [busy, setBusy] = useState<string | null>(null);
  const [task, setTask] = useState("");
  // Old links (push, WhatsApp) still point at ?tab=…
  useEffect(() => {
    const t = sp.get("tab");
    if (t === "alerts" || t === "tasks") router.replace(`/admin/crm/${t}`);
  }, [sp, router]);
  const today = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" }).format(new Date());

  async function act(key: string, body: Record<string, unknown>) {
    setBusy(key);
    const r = await crmAction(body);
    setBusy(null);
    if (r.ok) await reload();
    return r.ok;
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>{loading ? "טוען…" : ""}</p>;
  const rows = data.rows;

  const btn = "min-h-[40px] px-3 rounded-[10px] text-sm font-semibold inline-flex items-center gap-1.5";
  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <PageHead title={`${greeting()}, ${me?.member ? me.name.split(" ")[0] : "יאיר"}`} sub={`${today} · ${rows.length ? `${rows.length} דברים מחכים לך` : "אין משהו שמחכה לך"}`}
        actions={<Link href="/admin/crm/leads?new=1" className="min-h-[44px] px-4 rounded-xl text-sm font-bold inline-flex items-center" style={{ background: C.coral, color: C.ink, textDecoration: "none" }}>+ ליד חדש</Link>} />
      <CrmPushBanner />

      <div className="flex gap-2">
        <input value={task} onChange={e => setTask(e.target.value)} onKeyDown={async e => { if (e.key === "Enter" && task.trim() && await act("task", { action: "task.create", title: task, due: isoDay(0) })) setTask(""); }}
          placeholder="משימה להיום, למשל: להתקשר לדני מחולון" className="flex-1 min-w-0 h-11 rounded-xl px-3 text-[15px] bg-white" style={{ border: "1px solid #C7D8D5" }} aria-label="משימה חדשה להיום" />
        {task.trim() && <button type="button" disabled={busy === "task"} onClick={async () => { if (await act("task", { action: "task.create", title: task, due: isoDay(0) })) setTask(""); }} className="h-11 px-4 rounded-xl text-sm font-bold" style={{ background: C.petrol, color: "#fff" }}>הוסף</button>}
      </div>

      {rows.length === 0 && (
        <section className="bg-white rounded-2xl p-6 text-center" style={{ border: `1px solid ${C.line}` }}>
          <p className="m-0 text-lg font-bold" style={{ color: C.petrol }}>השולחן נקי</p>
          <p className="m-0 mt-1 text-sm" style={{ color: C.muted }}>כשמשהו יחכה לך, הוא יופיע כאן עם הפעולה שלו.</p>
        </section>
      )}

      {rows.map(r => {
        const [tag, tone] = TAG[r.kind] ?? ["", "info"];
        return (
          <section key={r.key} className="bg-white rounded-2xl px-3.5 py-3 flex flex-col gap-2" style={{ border: r.urgent ? `2px solid ${TONE.bad.dot}` : `1px solid ${C.line}` }}>
            <div className="flex items-start gap-2.5">
              {r.time ? <span className="shrink-0 text-[15px] font-bold mt-0.5" style={{ color: C.petrol, fontFamily: "Outfit, Heebo, sans-serif" }}>{r.time}</span> : <span className="shrink-0 mt-0.5"><Tag tone={tone}>{tag}</Tag></span>}
              <div className="flex-1 min-w-0">
                {r.href ? <Link href={r.href} className="font-semibold text-[15px] block" style={{ color: C.ink, textDecoration: "none" }}>{r.title}</Link> : <span className="font-semibold text-[15px] block">{r.title}</span>}
                {r.detail && <div className="text-[13px]" style={{ color: r.urgent ? "#B42318" : C.muted }}>{r.detail}</div>}
                {r.also.length > 0 && <div className="text-[12px] mt-0.5" style={{ color: C.muted }}>גם: {r.also.join(" · ")}</div>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.phone && <a href={`tel:${r.phone}`} className={btn} style={{ background: C.turquoise, color: C.ink, textDecoration: "none" }}>חייג</a>}
              {r.wa && <Link href={r.wa} className={btn} style={{ background: "#E7F8EE", color: "#1F7A4D", border: "1px solid #9ED9B6", textDecoration: "none" }}>וואטסאפ</Link>}
              {r.href && <Link href={r.href} className={btn} style={{ border: `1px solid ${C.petrol}`, color: C.petrol, textDecoration: "none" }}>פתח</Link>}
              {r.done && <button type="button" disabled={!!busy} onClick={() => act(r.key, { action: r.done!.action, id: r.done!.id, done: true, handled: true })} className={btn} style={{ border: `1px solid ${C.line}`, color: C.ink }}>✓ בוצע</button>}
              {!r.done && r.canHide && <button type="button" disabled={!!busy} onClick={() => act(r.key, { action: "today.hide", key: r.key })} className={btn} style={{ border: `1px solid ${C.line}`, color: C.ink }}>✓ טיפלתי</button>}
              {r.canHide && <button type="button" disabled={!!busy} onClick={() => act(r.key, { action: "today.hide", key: r.key, tomorrow: true })} className={btn} style={{ color: C.muted }}>מחר</button>}
            </div>
          </section>
        );
      })}

      <p className="m-0 text-xs flex flex-wrap gap-x-3 gap-y-1" style={{ color: C.muted }}>
        {data.hiddenCount > 0 && <span>{data.hiddenCount} נדחו למחר או סומנו</span>}
        {data.freeSlotsToday > 0 && <span>היום פתוחים עוד {data.freeSlotsToday} זמנים לשיחות</span>}
        <Link href="/admin/crm/calendar" style={{ color: C.petrol }}>יומן שיחות</Link>
        <Link href="/admin/crm/numbers" style={{ color: C.petrol }}>המספרים של העסק</Link>
      </p>
    </div>
  );
}

export default function CrmHome() {
  return <Suspense fallback={<p style={{ color: C.muted }}>טוען…</p>}><TodayInner /></Suspense>;
}
