import { NextRequest, NextResponse } from "next/server";
import { MEMBER_COOKIE } from "@/lib/crm/member-token";

/** A CRM member logs out: back to the login page. */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/crm-login", req.url));
  res.cookies.set(MEMBER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
