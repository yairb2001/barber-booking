"use client";

import { useEffect, useState } from "react";
import { C, TONE, Btn, Card, PageHead, useCrm, crmAction } from "../ui";
import { CrmPushSettings } from "../CrmPush";
import { PlansEditor, type PackSettings } from "./Plans";

type S = { callMinutes: number; breakMinutes: number; horizonDays: number; minNoticeMinutes: number; infraCostIls: number } & PackSettings;
type Data = { settings: S; testKey: boolean; pushDevices: number; plans: { key: string; name: string; apptsCap: number; messages: number; aiBudgetIls: number; priceIls: number }[]; providerConnected: boolean; reps: { id: string; name: string; phone: string | null; active: boolean; isOwner: boolean }[] };

const FIELDS: [keyof S, string, string][] = [
  ["callMinutes", "אורך שיחה", "דקות"],
  ["breakMinutes", "הפסקה אחרי כל שיחה", "דקות"],
  ["horizonDays", "כמה ימים קדימה ליד יכול לקבוע", "ימים"],
  ["minNoticeMinutes", "מינימום זמן מראש", "דקות"],
  ["infraCostIls", "עלות שרתים ודאטה בייס בחודש", "₪"],
];

export default function SettingsPage() {
  const { data, error, reload } = useCrm<Data>("view=settings");
  const [s, setS] = useState<S | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => { if (data) setS(data.settings); }, [data]);

  async function save() {
    if (!s) return;
    setBusy(true);
    const { callMinutes, breakMinutes, horizonDays, minNoticeMinutes, infraCostIls } = s;
    const r = await crmAction({ action: "settings.update", callMinutes, breakMinutes, horizonDays, minNoticeMinutes, infraCostIls });
    setBusy(false); setFlash(r.ok ? "נשמר" : r.error ?? "שגיאה");
    if (r.ok) await reload();
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data || !s) return <p style={{ color: C.muted }}>טוען…</p>;
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <PageHead title="הגדרות CRM" />
      {flash && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: C.mist, color: C.petrol }}>{flash}</p>}
      <Card title="מסלולים" aside={data.providerConnected ? "Invoice4U מחובר" : "Invoice4U עוד לא מחובר"}>
        <PlansEditor plans={data.plans} packs={s} onSaved={() => void reload()} />
      </Card>
      <Card title="התראות לטלפון">
        <CrmPushSettings devices={data.pushDevices} />
      </Card>
      <Card title="שיחות מכירה">
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {FIELDS.map(([k, label, unit]) => (
            <label key={k} className="flex flex-col gap-1 text-xs" style={{ color: C.muted }}>{label}
              <span className="flex items-center gap-2">
                <input type="number" min={0} value={s[k]} onChange={e => setS(x => x && ({ ...x, [k]: Math.max(0, Number(e.target.value) || 0) }))} className="h-11 w-28 rounded-xl px-3 text-sm text-slate-900" style={{ border: "1px solid #C7D8D5" }} />
                <span className="text-sm text-slate-700">{unit}</span>
              </span>
            </label>
          ))}
        </div>
        <Btn kind="dark" className="mt-4" disabled={busy} onClick={save}>{busy ? "שומר…" : "שמור"}</Btn>
      </Card>

      <Card title="מפתח API לבדיקות">
        {data.testKey
          ? <p className="m-0 text-sm" style={{ color: TONE.ok.color }}>מחובר. כל הבדיקות, ארגז החול והתצוגה המקדימה באשף עובדים על מפתח הבדיקות, בנפרד מהסוכנים החיים.</p>
          : <div className="text-sm flex flex-col gap-2" style={{ color: C.ink }}>
              <p className="m-0" style={{ color: TONE.warn.color }}>עוד לא מחובר. בינתיים הבדיקות עובדות על המפתח של הפרודקשן.</p>
              <ol className="m-0 ps-5 flex flex-col gap-1">
                <li>console.anthropic.com ← API Keys ← Create Key, בשם chator-tests.</li>
                <li>מומלץ להגדיר לו תקרת הוצאה חודשית נמוכה בקונסולה.</li>
                <li>לשמור את המפתח בקובץ ולהגיד לClaude, שיחבר אותו ל-Vercel (לא להדביק בצ׳אט).</li>
              </ol>
            </div>}
      </Card>

      <Card title="נציגי מכירות">
        {data.reps.map(r => <p key={r.id} className="m-0 mb-1.5 text-sm">{r.name}{r.isOwner ? " (אתה)" : ""} · {r.phone ?? "בלי טלפון"} · {r.active ? "פעיל" : "מושבת"}</p>)}
        <p className="m-0 mt-2 text-xs" style={{ color: C.muted }}>מוסיפים נציג ופותחים לו חלונות ביומן השיחות.</p>
      </Card>
    </div>
  );
}
