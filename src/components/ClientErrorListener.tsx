"use client";

// Report errors React's boundaries never see (event handlers, async code,
// failed chunk loads during navigation). Report only — each distinct message
// once per page load — and reload once for a stale-chunk error.
import { useEffect } from "react";
import { reportClientError, isChunkError, reloadOnce } from "@/lib/client-error";

export default function ClientErrorListener() {
  useEffect(() => {
    const seen = new Set<string>();
    const handle = (err: unknown, kind: string) => {
      const key = String((err as { message?: string } | null)?.message ?? err).slice(0, 200);
      if (!key || seen.has(key) || /ResizeObserver loop/i.test(key)) return;
      seen.add(key);
      const chunk = isChunkError(err);
      reportClientError(err, { kind: chunk ? "chunk" : kind, reloaded: chunk });
      if (chunk) reloadOnce();
    };
    const onError = (e: ErrorEvent) => handle(e.error ?? e.message, "window");
    const onRejection = (e: PromiseRejectionEvent) => handle(e.reason, "promise");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
