import Link from "next/link";
import NoticeEditor from "@/components/NoticeEditor";

/** A barber's own "הודעה חשובה" popup for customers who pick him (11.10.2026). */
export default function BarberNoticePage() {
  return (
    <div className="p-6 sm:p-8 overflow-auto h-full">
      <Link href="/admin/barber-settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות שלי</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">הודעה ללקוחות שלי</h1>
        <p className="text-neutral-500 text-sm mt-1">פופ-אפ שקופץ ללקוח כשהוא בוחר בך בקביעת תור. למשל חופשה, שינוי שעות או משהו שחשוב שידע. ההודעה עולה ללקוחות אחרי שהמנהל מאשר אותה.</p>
      </div>
      <div className="max-w-2xl"><NoticeEditor /></div>
    </div>
  );
}
