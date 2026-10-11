"use client";

import { useEffect, useState } from "react";
import { apiWithSlug } from "@/lib/public-nav";

/**
 * The booking flow's "הודעה חשובה" popup (src/lib/booking-notice.ts): the
 * business's general notice on the barbers screen, a barber's own when a
 * customer picks him, and both on the confirm screen when he skipped straight
 * there (a quick slot from the home page). Each text shows once per visit;
 * an edited text shows again.
 */
export type NoticeItem = { key: string; title: string; text: string; avatarUrl?: string | null };
export type Notices = { general: string | null; staff: Record<string, string> };

const hash = (t: string) => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
export const generalKey = (text: string) => `bk_notice:g:${hash(text)}`;
export const staffKey = (staffId: string, text: string) => `bk_notice:s:${staffId}:${hash(text)}`;
export function seen(key: string): boolean { try { return sessionStorage.getItem(key) === "1"; } catch { return false; } }
export function markSeen(keys: string[]) { try { for (const k of keys) sessionStorage.setItem(k, "1"); } catch { /* private mode */ } }

export function useBookingNotices(slug: string | null | undefined): Notices | null {
  const [n, setN] = useState<Notices | null>(null);
  useEffect(() => {
    fetch(apiWithSlug("/api/notices", slug ?? null)).then(r => (r.ok ? r.json() : null)).then(j => {
      if (j && typeof j === "object") setN({ general: typeof j.general === "string" ? j.general : null, staff: j.staff && typeof j.staff === "object" ? j.staff : {} });
    }).catch(() => {});
  }, [slug]);
  return n;
}

export function NoticePopup({ items, onDone, cta = "הבנתי" }: { items: NoticeItem[]; onDone: () => void; cta?: string }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  if (!items.length) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-5" dir="rtl" role="dialog" aria-modal="true" aria-label="הודעה חשובה" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl max-h-[85vh] overflow-y-auto">
        <p className="text-[11px] font-bold tracking-[0.15em] mb-3" style={{ color: "var(--brand, #0f766e)" }}>הודעה חשובה</p>
        <div className="space-y-4">
          {items.map(it => (
            <div key={it.key}>
              <div className="flex items-center gap-2.5 mb-1.5">
                {it.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                )}
                <p className="text-[15px] font-bold text-slate-900">{it.title}</p>
              </div>
              <p className="text-[14px] leading-relaxed text-slate-700 whitespace-pre-line break-words">{it.text}</p>
            </div>
          ))}
        </div>
        <button type="button" onClick={onDone} autoFocus className="mt-5 w-full rounded-2xl py-3 text-[15px] font-bold text-white active:scale-[0.99] transition" style={{ background: "var(--brand, #0f766e)" }}>
          {cta}
        </button>
      </div>
    </div>
  );
}

/**
 * The confirm screen: whatever the customer hasn't seen yet in this visit, the
 * general notice and this barber's, in one popup (he may have skipped the
 * barbers screen with a quick slot).
 */
export function ConfirmNotices({ slug, staffId, staffName, avatarUrl }: { slug: string | null | undefined; staffId: string | null; staffName?: string | null; avatarUrl?: string | null }) {
  const notices = useBookingNotices(slug);
  // Decided once, when the notices arrive; titles follow the barber's details as they load.
  const [picked, setPicked] = useState<{ key: string; kind: "g" | "s"; text: string }[] | null>(null);
  useEffect(() => {
    if (!notices || picked) return;
    const out: { key: string; kind: "g" | "s"; text: string }[] = [];
    if (notices.general && !seen(generalKey(notices.general))) out.push({ key: generalKey(notices.general), kind: "g", text: notices.general });
    const t = staffId ? notices.staff[staffId] : undefined;
    if (staffId && t && !seen(staffKey(staffId, t))) out.push({ key: staffKey(staffId, t), kind: "s", text: t });
    setPicked(out);
  }, [notices, staffId, picked]);
  if (!picked?.length) return null;
  const items: NoticeItem[] = picked.map(p => p.kind === "g"
    ? { key: p.key, title: "הודעה מהמספרה", text: p.text }
    : { key: p.key, title: staffName ? `הודעה מ${staffName}` : "הודעה מהספר", text: p.text, avatarUrl });
  return <NoticePopup items={items} onDone={() => { markSeen(picked.map(i => i.key)); setPicked([]); }} />;
}
