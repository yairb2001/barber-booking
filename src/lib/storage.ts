import { AwsClient } from "aws4fetch";

// Public file storage. Cloudflare R2 when R2_* is configured (own server),
// Vercel Blob otherwise. Returns the public URL of the stored object.
const r2 = process.env.R2_ACCOUNT_ID && process.env.R2_BUCKET && process.env.R2_PUBLIC_URL
  ? new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!, service: "s3", region: "auto" })
  : null;

export function storageEnabled(): boolean {
  return !!r2 || !!process.env.BLOB_READ_WRITE_TOKEN;
}

export async function putPublic(key: string, body: Buffer | Blob, contentType?: string): Promise<string> {
  if (r2) {
    const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}/${key}`;
    const data = body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : body;
    const res = await r2.fetch(endpoint, { method: "PUT", body: data, headers: contentType ? { "content-type": contentType } : {} });
    if (!res.ok) throw new Error(`R2 put failed: ${res.status}`);
    return `${process.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${key}`;
  }
  const { put } = await import("@vercel/blob");
  const blob = await put(key, body, { access: "public", addRandomSuffix: false, contentType });
  return blob.url;
}
