import { NextRequest, NextResponse } from "next/server";
import { memberLogin } from "@/lib/crm/members";
import { MEMBER_COOKIE, MEMBER_MAX_AGE, signMemberToken } from "@/lib/crm/member-token";

/** A reports member logs in (25.10.2026): phone + password → the crm_member cookie. */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const phone = typeof b.phone === "string" ? b.phone : "";
  const password = typeof b.password === "string" ? b.password : "";
  const m = phone && password ? await memberLogin(phone, password) : null;
  if (!m) {
    await new Promise(r => setTimeout(r, 600)); // slows guessing
    return NextResponse.json({ error: "הטלפון או הסיסמה לא נכונים" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true, name: m.name });
  res.cookies.set(MEMBER_COOKIE, await signMemberToken(m.id), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: MEMBER_MAX_AGE });
  return res;
}
