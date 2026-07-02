/**
 * POST /api/otp/clear-session
 *
 * Clears the bk_session cookie — used when the customer clicks "לא אתה?" (Not you?)
 * to switch to a different person.
 */

import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("bk_session", "", {
    httpOnly: true,
    sameSite: "lax", // match how the cookie is set (verify / auto-token)
    maxAge: 0,
    path: "/",
  });
  return response;
}
