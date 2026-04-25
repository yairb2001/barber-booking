import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }

  // Validate file type
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "only images allowed" }, { status: 400 });
  }

  // Max 8MB
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large (max 8MB)" }, { status: 400 });
  }

  // ── Option 1: Vercel Blob (production) ─────────────────────────────────────
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { put } = await import("@vercel/blob");
      const ext = file.name.split(".").pop() || "jpg";
      const filename = `uploads/${randomUUID()}.${ext}`;
      const blob = await put(filename, file, {
        access: "public",
        addRandomSuffix: false,
      });
      return NextResponse.json({ url: blob.url });
    } catch (err) {
      console.error("Vercel Blob upload failed:", err);
      return NextResponse.json({ error: "upload failed" }, { status: 500 });
    }
  }

  // ── Option 2: Local filesystem (development) ────────────────────────────────
  try {
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${randomUUID()}.${ext}`;
    const uploadDir = join(process.cwd(), "public", "uploads");
    await writeFile(join(uploadDir, filename), buffer);
    const url = `/uploads/${filename}`;
    return NextResponse.json({ url });
  } catch (err) {
    console.error("Local upload failed:", err);
    return NextResponse.json({ error: "upload failed — in production, set BLOB_READ_WRITE_TOKEN" }, { status: 500 });
  }
}
