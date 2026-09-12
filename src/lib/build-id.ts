/**
 * Build identity, baked in at build time. Vercel exposes the commit SHA;
 * locally it falls back to a per-process stamp so the banner never fires in
 * dev. NEXT_PUBLIC_ so the client bundle carries the same value.
 */
export const BUILD_ID: string =
  process.env.NEXT_PUBLIC_BUILD_ID ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  "dev";
export const BUILD_LABEL: string = BUILD_ID === "dev" ? "פיתוח מקומי" : BUILD_ID;
