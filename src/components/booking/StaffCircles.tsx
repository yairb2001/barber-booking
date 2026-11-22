"use client";

import Link from "next/link";
import { publicHref } from "@/lib/public-nav";
import { useVocab } from "@/components/VocabProvider";

// "Choose barber" as story circles (22.11.2026): every barber fits on the first
// screen, even 9. Colors come only from the business theme variables.

export type CircleStaff = { id: string; name: string; avatarUrl: string | null };
export type CircleSlot = { staffId: string; serviceId: string; date: string; time: string };

// First name, plus the last name's initial when two people share a first name.
export function shortName(name: string, all: { name: string }[]): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0];
  const twins = all.filter(s => s.name.trim().split(/\s+/)[0] === first).length > 1;
  return twins && parts.length > 1 ? `${first} ${parts[parts.length - 1][0]}׳` : first;
}

function Avatar({ m, className }: { m: CircleStaff; className: string }) {
  return m.avatarUrl
    ? <img src={m.avatarUrl} alt="" className={`${className} object-cover`} style={{ objectPosition: "50% 25%" }} />
    : <span className={`${className} flex items-center justify-center font-bold`}
        style={{ background: "var(--bg-alt)", color: "var(--brand)" }}>{m.name.trim()[0]}</span>;
}

// "Any barber": a wide pill, so it never reads as one more barber.
export function AnyStaffPill({ slug, staff }: { slug: string | null; staff: CircleStaff[] }) {
  const v = useVocab();
  if (staff.length < 2) return null;
  return (
    <Link href={publicHref(slug, "/book/team-date")}
      className="flex items-center gap-2.5 h-[52px] rounded-full ps-2.5 pe-4 active:scale-[0.98] transition-transform"
      style={{ background: "var(--card)", border: "1.5px solid var(--brand)" }}>
      <span className="flex flex-row-reverse flex-shrink-0">
        {staff.filter(s => s.avatarUrl).slice(0, 3).map((m, i) => (
          <Avatar key={m.id} m={m} className={`w-[30px] h-[30px] rounded-full ${i ? "-ml-2.5" : ""}`} />
        ))}
      </span>
      <span className="flex-1 min-w-0 truncate text-[16px] font-semibold" style={{ color: "var(--text-pri)" }}>
        לא משנה לי {v.staffDef}
      </span>
      <span className="flex-shrink-0 rounded-full px-3 py-1.5 text-[13px] font-bold text-white" style={{ background: "var(--brand)" }}>
        הכי מהר ‹
      </span>
    </Link>
  );
}

// Barbers in the order the business set in the admin (sortOrder).
export function StaffCircleGrid<S extends CircleSlot>({ slug, staff, loading, slotOf, checked, dayText }: {
  slug: string | null;
  staff: CircleStaff[];
  loading: boolean;
  slotOf: (id: string) => S | undefined;
  checked: Set<string>;
  dayText: (s: S) => string;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-y-3">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="w-20 h-20 rounded-full animate-pulse" style={{ background: "var(--bg-alt)" }} />
            <div className="w-12 h-3 rounded animate-pulse" style={{ background: "var(--bg-alt)" }} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-y-3">
      {staff.map(m => {
        const slot = slotOf(m.id);
        const none = !slot && checked.has(m.id);
        const href = publicHref(slug, `/book/service?staffId=${m.id}`);
        return (
          <div key={m.id} className="flex flex-col items-center text-center min-w-0">
            <Link href={href} className="flex flex-col items-center active:scale-95 transition-transform">
              <span className="w-20 h-20 rounded-full p-[3px] mb-1.5"
                style={{ background: none ? "var(--divider)" : "var(--brand-soft)" }}>
                <Avatar m={m} className={`w-full h-full rounded-full text-2xl ${none ? "grayscale opacity-60" : ""}`} />
              </span>
              <span className="text-[14px] font-semibold leading-tight truncate max-w-[104px]"
                style={{ color: "var(--text-pri)" }}>{shortName(m.name, staff)}</span>
            </Link>
            {slot ? (
              <Link href={publicHref(slug, `/book/confirm?staffId=${slot.staffId}&serviceId=${slot.serviceId}&date=${slot.date}&time=${slot.time}&from=home`)}
                className="flex flex-col items-center text-[12px] leading-tight px-2 py-1" style={{ color: "var(--text-sec)" }}>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>התור הקרוב:</span>
                <span>{dayText(slot)} {slot.time}</span>
              </Link>
            ) : (
              <span className="text-[12px] leading-tight px-2 py-1" style={{ color: "var(--text-muted)" }}>
                {none ? "אין תורים כרגע" : " "}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
