"use client";
// Send a browser crash to /api/client-error (no query string, no personal data).
import { BUILD_ID } from "@/lib/build-id";

/** A stale chunk after a deploy: the page asks for a file of the previous build. */
export function isChunkError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const s = `${e?.name ?? ""} ${e?.message ?? ""}`;
  return /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Importing a module script failed|error loading dynamically/i.test(s);
}

export function reportClientError(err: unknown, extra: { kind?: string; digest?: string; reloaded?: boolean } = {}) {
  try {
    const e = err as { name?: string; message?: string; stack?: string } | null;
    const body = JSON.stringify({
      path: typeof location !== "undefined" ? location.pathname : null,
      message: `${e?.name ? e.name + ": " : ""}${e?.message ?? String(err)}`,
      stack: e?.stack ?? null,
      digest: extra.digest ?? null,
      kind: extra.kind ?? (isChunkError(err) ? "chunk" : "render"),
      build: BUILD_ID,
      reloaded: !!extra.reloaded,
    });
    const blob = new Blob([body], { type: "application/json" });
    if (!(navigator.sendBeacon && navigator.sendBeacon("/api/client-error", blob))) {
      fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch { /* never throw from the reporter */ }
}

/** Reload once per page per 60s — fixes a stale-build crash without looping. */
export function reloadOnce(): boolean {
  try {
    const key = `reloaded:${location.pathname}`;
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch { /* storage blocked: still reload once */ }
  location.reload();
  return true;
}
