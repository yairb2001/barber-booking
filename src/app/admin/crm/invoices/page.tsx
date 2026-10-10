"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { C, NUM, PageHead, useCrm } from "../ui";

/** All invoices to Chator customers (10.10.2026). From Invoice4U once connected; manual until then. */
type Inv = { id: string; businessId: string; businessName: string; number: string | null; issuedAt: string; amountIls: number; status: string; pdfUrl: string | null; provider: string; sentAt: string | null };
type Data = { providerConnected: boolean; invoices: Inv[] };
const STATUS: Record<string, [string, string, string]> = { paid: ["שולם", "#E3F7EF", "#0F6B4F"], unpaid: ["לא שולם", "#FFF1D6", "#7A4A00"], failed: ["נכשל", "#FDECEA", "#B42318"] };
const day = (iso: string) => new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "2-digit", timeZone: "Asia/Jerusalem" }).format(new Date(iso));

export default function InvoicesPage() {
  const { data, error } = useCrm<Data>("view=invoices");
  const [filter, setFilter] = useState<"all" | "paid" | "open">("all");
  const list = useMemo(() => (data?.invoices ?? []).filter(i => filter === "all" || (filter === "paid" ? i.status === "paid" : i.status !== "paid")), [data, filter]);
  const month = new Date().toISOString().slice(0, 7);
  const monthTotal = (data?.invoices ?? []).filter(i => i.status === "paid" && i.issuedAt.slice(0, 7) === month).reduce((s, i) => s + i.amountIls, 0);
  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>טוען…</p>;
  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="חשבוניות" sub={`${data.providerConnected ? "מגיעות לבד מ-Invoice4U" : "Invoice4U עוד לא מחובר, מוסיפים ידנית מכרטיס הלקוח"} · שולם החודש ${monthTotal.toLocaleString("he-IL")} ₪`} />
      <div className="flex gap-1.5">
        {([["all", "הכל"], ["open", "פתוחות ונכשלו"], ["paid", "שולמו"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className="h-10 px-3.5 rounded-full text-sm font-semibold" style={filter === k ? { background: C.petrol, color: "#fff" } : { background: "#fff", color: C.ink, border: "1px solid #C7D8D5" }}>{l}</button>
        ))}
      </div>
      <section className="bg-white rounded-2xl" style={{ border: `1px solid ${C.line}` }}>
        {list.length === 0 && <p className="m-0 p-4 text-sm" style={{ color: C.muted }}>אין חשבוניות.</p>}
        {list.map((i, k) => {
          const [lbl, bg, fg] = STATUS[i.status] ?? STATUS.paid;
          return (
            <div key={i.id} className="flex items-center gap-3 px-3.5 py-3" style={{ borderTop: k ? `1px solid ${C.soft}` : undefined }}>
              <div className="flex-1 min-w-0">
                <Link href={`/admin/crm/customers/${i.businessId}`} className="font-bold text-[15px] block truncate" style={{ color: C.ink, textDecoration: "none" }}>{i.businessName}</Link>
                <span className="text-[13px]" style={{ color: C.muted }}>{i.number ? `#${i.number} · ` : ""}{day(i.issuedAt)}{i.sentAt ? " · נשלחה" : ""}</span>
              </div>
              <span className="text-sm font-bold" style={NUM}>{i.amountIls.toLocaleString("he-IL")} ₪</span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: bg, color: fg }}>{lbl}</span>
              {i.pdfUrl ? <a href={i.pdfUrl} target="_blank" rel="noreferrer" className="min-h-[38px] px-3 rounded-[10px] text-sm font-semibold inline-flex items-center" style={{ border: `1px solid ${C.petrol}`, color: C.petrol, textDecoration: "none" }}>פתח</a> : <span className="w-[52px]" />}
            </div>
          );
        })}
      </section>
    </div>
  );
}
