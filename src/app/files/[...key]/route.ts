import { readFile } from "fs/promises";
import { extname } from "path";
import { storagePath } from "@/lib/storage";

// Serves files stored on the server's disk volume (STORAGE_DIR). Keys are random, so files are public by URL.
const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".ogg": "audio/ogg", ".oga": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "video/mp4",
  ".pdf": "application/pdf", ".webm": "video/webm",
};

export async function GET(_req: Request, { params }: { params: { key: string[] } }) {
  const path = storagePath(params.key.join("/"));
  if (!path) return new Response("not found", { status: 404 });
  try {
    const data = await readFile(path);
    return new Response(data, {
      headers: {
        "content-type": TYPES[extname(path).toLowerCase()] || "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
