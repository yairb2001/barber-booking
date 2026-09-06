"use client";

import { useEffect, useState } from "react";

/**
 * Customer preview — shows THIS business's public storefront in a frame.
 *
 * The path must come from the session (`/api/admin/me` → publicPath: "/" for the
 * legacy root business, "/<slug>" for every tenant). It used to be hardcoded to
 * "/", which made every tenant preview the ROOT shop instead of their own — a
 * tenant-isolation bug, not just a cosmetic one. Same source of truth the
 * sidebar's share-link already uses (AdminLayoutClient).
 */
export default function PreviewPage() {
  const [publicPath, setPublicPath] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (me?.publicPath) setPublicPath(me.publicPath);
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, []);

  // Display host + path, so the fake address bar shows the REAL url (it used to
  // always read "localhost:3001", which is wrong in production).
  const displayUrl =
    publicPath && typeof window !== "undefined"
      ? `${window.location.host}${publicPath === "/" ? "" : publicPath}`
      : "";

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
            <div className="w-3 h-3 rounded-full bg-slate-700" />
            <div className="w-3 h-3 rounded-full bg-emerald-400" />
          </div>
          <div className="flex-1 bg-white rounded-lg px-3 py-1 text-xs text-neutral-400 border border-neutral-200 truncate" dir="ltr">
            {displayUrl || "…"}
          </div>
          {publicPath && (
            <a href={publicPath} target="_blank" className="text-xs text-slate-800 hover:underline shrink-0">פתח בטאב →</a>
          )}
        </div>
        {publicPath ? (
          <iframe src={publicPath} className="w-full h-full border-0" title="Customer Preview" />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-neutral-400">
            {failed ? "לא הצלחנו לטעון את התצוגה — רענן את הדף" : "טוען תצוגה…"}
          </div>
        )}
      </div>
    </div>
  );
}
