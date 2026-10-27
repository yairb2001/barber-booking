import { AwsClient } from "aws4fetch";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";

// Public file storage, first configured wins:
// - STORAGE_DIR: a disk volume on our own server, served by /files/<key>
// - R2_*: Cloudflare R2
// - BLOB_READ_WRITE_TOKEN: Vercel Blob
// Returns the public URL of the stored object.
const r2 = process.env.R2_ACCOUNT_ID && process.env.R2_BUCKET && process.env.R2_PUBLIC_URL
  ? new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!, service: "s3", region: "auto" })
  : null;

export function storageEnabled(): boolean {
  return !!process.env.STORAGE_DIR || !!r2 || !!process.env.BLOB_READ_WRITE_TOKEN;
}

/** Disk path for a key, or null if the key tries to leave STORAGE_DIR. */
export function storagePath(key: string): string | null {
  const root = process.env.STORAGE_DIR;
  if (!root || !/^[A-Za-z0-9._\-/]+$/.test(key) || key.split("/").some(p => p === ".." || p === "")) return null;
  return join(root, key);
}

export async function putPublic(key: string, body: Buffer | Blob, contentType?: string): Promise<string> {
  const data = body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : body;
  if (process.env.STORAGE_DIR) {
    const path = storagePath(key);
    if (!path) throw new Error(`invalid storage key: ${key}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    return `${base}/files/${key}`;
  }
  if (r2) {
    const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}/${key}`;
    const res = await r2.fetch(endpoint, { method: "PUT", body: new Uint8Array(data), headers: contentType ? { "content-type": contentType } : {} });
    if (!res.ok) throw new Error(`R2 put failed: ${res.status}`);
    return `${process.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${key}`;
  }
  const { put } = await import("@vercel/blob");
  const blob = await put(key, data, { access: "public", addRandomSuffix: false, contentType });
  return blob.url;
}
