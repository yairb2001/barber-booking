"use client";

import { useState } from "react";
import { C, Btn, Card, useCrm, crmAction } from "../ui";

/**
 * Logins to the CRM's reports screen (25.10.2026, Yair: "אשתי תאשר, תבנה לה כניסה
 * משלה"). Yair sets the phone and password; the member logs in at /crm-login and
 * sees only the reports: sending them to the fix agent and approving fixes.
 */
type M = { id: string; name: string; phone: string; scope: string; createdAt: string };

export function MembersCard() {
  const { data, reload } = useCrm<{ members: M[] }>("view=members");
  const [f, setF] = useState({ name: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const input = "h-11 rounded-xl px-3 text-sm bg-white min-w-0";
  async function add() {
    setBusy(true); setMsg(null);
    const r = await crmAction({ action: "member.add", ...f });
    setBusy(false);
    if (r.ok) { setF({ name: "", phone: "", password: "" }); setMsg("נשמר. הכניסה בכתובת /crm-login"); await reload(); } else setMsg(r.error ?? "לא נשמר");
  }
  return (
    <Card title="כניסות לצוות" aside="רואים רק את מסך הדיווחים">
      <div className="flex flex-col gap-2">
        {(data?.members ?? []).map(m => (
          <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2" style={{ background: C.soft }}>
            <span className="text-sm"><b>{m.name}</b> · <span dir="ltr">{m.phone}</span> · דיווחים ואישורים</span>
            <Btn kind="ghost" className="!min-h-[36px]" disabled={busy} onClick={async () => { if (confirm(`לבטל את הכניסה של ${m.name}?`)) { await crmAction({ action: "member.remove", id: m.id }); await reload(); } }}>בטל כניסה</Btn>
          </div>
        ))}
        {data && data.members.length === 0 && <p className="m-0 text-sm" style={{ color: C.muted }}>עוד אין כניסות.</p>}
        <div className="grid gap-2 mt-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} placeholder="שם" aria-label="שם" className={input} style={{ border: "1px solid #C7D8D5" }} />
          <input value={f.phone} onChange={e => setF(x => ({ ...x, phone: e.target.value }))} placeholder="טלפון" aria-label="טלפון" inputMode="tel" dir="ltr" className={`${input} text-right`} style={{ border: "1px solid #C7D8D5" }} />
          <input value={f.password} onChange={e => setF(x => ({ ...x, password: e.target.value }))} placeholder="סיסמה (6 תווים לפחות)" aria-label="סיסמה" type="password" autoComplete="new-password" className={input} style={{ border: "1px solid #C7D8D5" }} />
        </div>
        <Btn kind="dark" className="self-start" disabled={busy || !f.name.trim() || !f.phone.trim() || f.password.length < 6} onClick={() => void add()}>{busy ? "שומר…" : "הוסף כניסה"}</Btn>
        {msg && <p className="m-0 text-xs" style={{ color: C.petrol }}>{msg}</p>}
        <p className="m-0 text-xs" style={{ color: C.muted }}>אותו טלפון שוב = סיסמה חדשה. היא נכנסת בכתובת /crm-login ורואה רק את הדיווחים.</p>
      </div>
    </Card>
  );
}
