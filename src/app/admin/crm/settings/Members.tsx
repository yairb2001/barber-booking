"use client";

import { useState } from "react";
import { C, Btn, Card, useCrm, crmAction } from "../ui";

/**
 * The CRM's own logins (25.10.2026, Yair: "אשתי תאשר, תבנה לה כניסה משלה", and the
 * same day "גישה לכל ה-CRM, היא מנהלת ראשית"). Yair sets the phone, password and
 * what she sees: the whole CRM, or only the reports (sending them to the fix
 * agent and approving fixes). The member logs in at /crm-login.
 */
const SCOPES = [{ key: "admin", label: "כל ה-CRM" }, { key: "reports", label: "רק דיווחים" }] as const;
const scopeLabel = (s: string) => SCOPES.find(x => x.key === s)?.label ?? "רק דיווחים";
type M = { id: string; name: string; phone: string; scope: string; createdAt: string };

export function MembersCard() {
  const { data, reload } = useCrm<{ members: M[] }>("view=members");
  const [f, setF] = useState({ name: "", phone: "", password: "", scope: "admin" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const input = "h-11 rounded-xl px-3 text-sm bg-white min-w-0";
  async function add() {
    setBusy(true); setMsg(null);
    const r = await crmAction({ action: "member.add", ...f });
    setBusy(false);
    if (r.ok) { setF({ name: "", phone: "", password: "", scope: "admin" }); setMsg("נשמר. הכניסה בכתובת /crm-login"); await reload(); } else setMsg(r.error ?? "לא נשמר");
  }
  return (
    <Card title="כניסות לצוות" aside="כל ה-CRM, או רק הדיווחים">
      <div className="flex flex-col gap-2">
        {(data?.members ?? []).map(m => (
          <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2" style={{ background: C.soft }}>
            <span className="text-sm"><b>{m.name}</b> · <span dir="ltr">{m.phone}</span> · {scopeLabel(m.scope)}</span>
            <span className="flex flex-wrap gap-1">
            <Btn kind="ghost" className="!min-h-[36px]" disabled={busy} onClick={async () => { setBusy(true); await crmAction({ action: "member.scope", id: m.id, scope: m.scope === "admin" ? "reports" : "admin" }); setBusy(false); await reload(); }}>{m.scope === "admin" ? "להגביל לדיווחים" : "לפתוח את כל ה-CRM"}</Btn>
            <Btn kind="ghost" className="!min-h-[36px]" disabled={busy} onClick={async () => { if (confirm(`לבטל את הכניסה של ${m.name}?`)) { await crmAction({ action: "member.remove", id: m.id }); await reload(); } }}>בטל כניסה</Btn>
            </span>
          </div>
        ))}
        {data && data.members.length === 0 && <p className="m-0 text-sm" style={{ color: C.muted }}>עוד אין כניסות.</p>}
        <div className="grid gap-2 mt-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} placeholder="שם" aria-label="שם" className={input} style={{ border: "1px solid #C7D8D5" }} />
          <input value={f.phone} onChange={e => setF(x => ({ ...x, phone: e.target.value }))} placeholder="טלפון" aria-label="טלפון" inputMode="tel" dir="ltr" className={`${input} text-right`} style={{ border: "1px solid #C7D8D5" }} />
          <input value={f.password} onChange={e => setF(x => ({ ...x, password: e.target.value }))} placeholder="סיסמה (6 תווים לפחות)" aria-label="סיסמה" type="password" autoComplete="new-password" className={input} style={{ border: "1px solid #C7D8D5" }} />
          <select value={f.scope} onChange={e => setF(x => ({ ...x, scope: e.target.value }))} aria-label="מה רואים" className={input} style={{ border: "1px solid #C7D8D5" }}>
            {SCOPES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <Btn kind="dark" className="self-start" disabled={busy || !f.name.trim() || !f.phone.trim() || f.password.length < 6} onClick={() => void add()}>{busy ? "שומר…" : "הוסף כניסה"}</Btn>
        {msg && <p className="m-0 text-xs" style={{ color: C.petrol }}>{msg}</p>}
        <p className="m-0 text-xs" style={{ color: C.muted }}>אותו טלפון שוב = סיסמה חדשה. הכניסה בכתובת /crm-login, עם כל ה-CRM או רק הדיווחים.</p>
      </div>
    </Card>
  );
}
