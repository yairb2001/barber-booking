import { NextRequest, NextResponse } from "next/server";
import { verifySession, COOKIE_NAME } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public auth endpoints (no session required) — login flow + first-run setup
  const PUBLIC_AUTH_PATHS = new Set([
    "/api/admin/auth/login",
    "/api/admin/auth/logout",
    "/api/admin/auth/setup",
    "/api/admin/auth/setup-status",
  ]);

  if (
    pathname === "/admin/login" ||
    PUBLIC_AUTH_PATHS.has(pathname)
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = await verifySession(token);

  if (!session) {
    if (pathname.startsWith("/api/admin")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    return NextResponse.redirect(url);
  }

  // Pass session info to API route handlers via request headers
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-session-business-id", session.businessId);
  requestHeaders.set("x-session-role", session.role);
  if (session.staffId) {
    requestHeaders.set("x-session-staff-id", session.staffId);
  } else {
    requestHeaders.delete("x-session-staff-id");
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

// NOTE: /api/cron/* is intentionally NOT in the matcher so it bypasses auth
// (Vercel Cron authenticates itself via CRON_SECRET header — see the endpoint).
export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
