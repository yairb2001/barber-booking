import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness } from "@/lib/session";
import { recordCrmNotification } from "@/lib/crm/notify";

/**
 * The shop's requests to Chator (15.10.2026, Yair: "צאט של בקשות מה חסר לך או
 * מה היית רוצה לשנות, תכתוב או תקליט בפירוט, עוברים על זה כל יום").
 *
 * GET  → the thread (oldest first); Chator's replies are marked seen.
 * POST → a written request (JSON { body }) or a recording (form: file, secs, body?).
 * Anyone on the team can write; each request lands in Chator's CRM (/admin/crm/requests).
 */
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_BODY = 4000;

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const items = await prisma.shopRequest.findMany({ where: { businessId: session.businessId }, orderBy: { createdAt: "asc" }, take: 300 });
  await prisma.shopRequest.updateMany({ where: { businessId: session.businessId, fromChator: true, seenAt: null }, data: { seenAt: new Date() } });
  return NextResponse.json({
    items: items.map(r => ({ id: r.id, fromChator: r.fromChator, author: r.authorName, body: r.body, audioUrl: r.audioUrl, audioSecs: r.audioSecs, at: r.createdAt, done: !!r.doneAt })),
  });
}

export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const biz = await getSessionBusiness(req, { id: true, name: true });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 400 });

  let body = "";
  let audioUrl: string | null = null;
  let audioSecs: number | null = null;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    body = String(form.get("body") ?? "").trim();
    const file = form.get("file") as File | null;
    if (file && file.size) {
      if (file.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "ההקלטה ארוכה מדי" }, { status: 413 });
      if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: "storage not configured" }, { status: 500 });
      const { put } = await import("@vercel/blob");
      const blob = await put(`requests/${biz.id}/${randomUUID()}.ogg`, Buffer.from(await file.arrayBuffer()), { access: "public", addRandomSuffix: false, contentType: "audio/ogg" });
      audioUrl = blob.url;
      const s = Number(form.get("secs"));
      audioSecs = Number.isFinite(s) && s > 0 ? Math.round(s) : null;
    }
  } else {
    const j = await req.json().catch(() => ({}));
    body = typeof j.body === "string" ? j.body.trim() : "";
  }
  if (!body && !audioUrl) return NextResponse.json({ error: "כתוב או הקלט את הבקשה" }, { status: 400 });

  const staff = session.staffId ? await prisma.staff.findUnique({ where: { id: session.staffId }, select: { name: true } }) : null;
  const author = staff?.name ?? (session.isOwner ? "בעל העסק" : null);
  const saved = await prisma.shopRequest.create({
    data: { businessId: biz.id, staffId: session.staffId ?? null, authorName: author, body: body.slice(0, MAX_BODY) || null, audioUrl, audioSecs },
  });

  // Into Chator's CRM feed (no push: Yair goes over them once a day).
  const preview = body ? (body.length > 120 ? `${body.slice(0, 120)}…` : body) : `🎤 הקלטה${audioSecs ? ` (${audioSecs} שניות)` : ""}`;
  await recordCrmNotification(`💡 בקשה מ${biz.name}${author && author !== "בעל העסק" ? ` (${author})` : ""}: ${preview}`, { kind: "customer", businessId: biz.id, href: `/admin/crm/requests?b=${biz.id}`, push: false }).catch(() => {});

  return NextResponse.json({ ok: true, item: { id: saved.id, fromChator: false, author, body: saved.body, audioUrl, audioSecs, at: saved.createdAt, done: false } });
}
