import { readFile } from "fs/promises";
import { extname } from "path";
import { storagePath } from "@/lib/storage";

// Serves files stored on the server's disk volume (STORAGE_DIR). Keys are random, so files are public by URL.
const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".ogg": "audio/ogg", ".oga": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "video/mp4",
  ".pdf": "application/pdf", ".webm": "video/webm",
};

/**
 * בקשה לחלק מהקובץ (Range): אייפון לא מנגן הקלטה או סרטון בלי זה. מאז המעבר לשרת
 * שלנו הנתיב החזיר תמיד את כל הקובץ, ולכן הקלטות וואטסאפ לא התנגנו (30.10.2026, יאיר).
 */
export async function GET(req: Request, { params }: { params: { key: string[] } }) {
  const path = storagePath(params.key.join("/"));
  if (!path) return new Response("not found", { status: 404 });
  const data = await readFile(path).catch(() => null);
  if (!data) return new Response("not found", { status: 404 });
  const size = data.length;
  const base = {
    "content-type": TYPES[extname(path).toLowerCase()] || "application/octet-stream",
    "cache-control": "public, max-age=31536000, immutable",
    "accept-ranges": "bytes",
  };
  const m = /^bytes=(\d*)-(\d*)$/.exec((req.headers.get("range") ?? "").trim());
  if (m && (m[1] || m[2])) {
    let start: number, end: number;
    if (!m[1]) { start = Math.max(0, size - Number(m[2])); end = size - 1; } // the last N bytes
    else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
    const chunk = data.subarray(start, end + 1);
    return new Response(chunk, { status: 206, headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(chunk.length) } });
  }
  return new Response(data, { headers: { ...base, "content-length": String(size) } });
}

/** אותן כותרות בלי גוף: נגנים בודקים קודם את הגודל ואם יש תמיכה בחלקים. */
export async function HEAD(req: Request, ctx: { params: { key: string[] } }) {
  const r = await GET(req, ctx);
  return new Response(null, { status: r.status, headers: r.headers });
}
