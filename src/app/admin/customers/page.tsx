"use client";

import { useEffect, useState } from "react";

type Customer = { id: string; name: string; phone: string; createdAt: string; isBlocked: boolean };

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/admin/customers?q=${encodeURIComponent(q)}`).then(r => r.json()).then(d => { setCustomers(d); setLoading(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="p-8 overflow-auto h-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">לקוחות</h1>
          <p className="text-neutral-500 text-sm mt-1">{customers.length} לקוחות</p>
        </div>
      </div>

      <div className="mb-4">
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="חפש לפי שם או טלפון..."
          className="w-full max-w-sm border border-neutral-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-neutral-400">טוען...</div>
        ) : customers.length === 0 ? (
          <div className="text-center py-12 text-neutral-400">אין לקוחות</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50">
                <th className="text-right px-5 py-3 text-neutral-500 font-medium">שם</th>
                <th className="text-right px-5 py-3 text-neutral-500 font-medium">טלפון</th>
                <th className="text-right px-5 py-3 text-neutral-500 font-medium">תאריך הצטרפות</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {customers.map(c => (
                <tr key={c.id} className={`hover:bg-neutral-50 ${c.isBlocked ? "opacity-50" : ""}`}>
                  <td className="px-5 py-4 font-medium text-neutral-900">{c.name}</td>
                  <td className="px-5 py-4 text-neutral-600" dir="ltr">{c.phone}</td>
                  <td className="px-5 py-4 text-neutral-400 text-xs">
                    {new Date(c.createdAt).toLocaleDateString("he-IL")}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex gap-3">
                      <a href={`tel:${c.phone}`} className="text-xs text-neutral-500 hover:text-neutral-800">📞</a>
                      <a href={`https://wa.me/${c.phone.replace(/\D/g,"")}`} target="_blank" className="text-xs text-emerald-500 hover:text-emerald-700">💬</a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
