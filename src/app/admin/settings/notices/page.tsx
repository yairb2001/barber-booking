import Link from "next/link";
import NoticeEditor from "@/components/NoticeEditor";

/** "הודעה חשובה ללקוחות" (11.10.2026): popups in the booking flow, general and per barber. */
export default function NoticesSettingsPage() {
  return (
    <div className="p-6 sm:p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">הודעה חשובה ללקוחות</h1>
        <p className="text-neutral-500 text-sm mt-1">פופ-אפ שקופץ ללקוח בזמן קביעת תור. כותבים חופשי, והוא מופיע בדיוק כמו שכתבת.</p>
      </div>
      <div className="max-w-2xl"><NoticeEditor /></div>
    </div>
  );
}
