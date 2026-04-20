"use client";

export default function PreviewPage() {
  return (
    <div className="p-8 overflow-auto h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">תצוגת לקוח</h1>
        <p className="text-neutral-500 text-sm mt-1">כך נראה האתר ללקוחות שלך</p>
      </div>
      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden" style={{ height: "calc(100vh - 220px)" }}>
        <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-100 bg-neutral-50">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-400" />
            <div className="w-3 h-3 rounded-full bg-amber-400" />
            <div className="w-3 h-3 rounded-full bg-emerald-400" />
          </div>
          <div className="flex-1 bg-white rounded-lg px-3 py-1 text-xs text-neutral-400 border border-neutral-200">
            localhost:3001
          </div>
          <a href="/" target="_blank" className="text-xs text-amber-600 hover:underline">פתח בטאב →</a>
        </div>
        <iframe src="/" className="w-full h-full border-0" title="Customer Preview" />
      </div>
    </div>
  );
}
