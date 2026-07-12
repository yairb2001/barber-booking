import { NextRequest, NextResponse } from "next/server";
import { verifySession, COOKIE_NAME } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Forward the visible pathname to Server Components so the root layout can
  // resolve the CORRECT tenant's theme for the first paint (see server-theme.ts).
  // Set on every request; the auth logic below only guards the /admin area.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);

  // Defense-in-depth: never let a CLIENT supply the session headers. They are
  // authoritative identity, set below ONLY from the verified JWT. Stripping them
  // up-front means even a future public route that reads getRequestSession()
  // can't be spoofed by an injected x-session-* header.
  requestHeaders.delete("x-session-business-id");
  requestHeaders.delete("x-session-role");
  requestHeaders.delete("x-session-staff-id");

  // Everything outside the admin area is public (storefront pages + public APIs
  // + crons). No session needed — just forward with the pathname header.
  const isAdminArea =
    pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  if (!isAdminArea) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

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
    return NextResponse.next({ request: { headers: requestHeaders } });
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
  requestHeaders.set("x-session-business-id", session.businessId);
  requestHeaders.set("x-session-role", session.role);
  if (session.staffId) {
    requestHeaders.set("x-session-staff-id", session.staffId);
  } else {
    requestHeaders.delete("x-session-staff-id");
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

// Matcher runs middleware on all routes EXCEPT Next internals and static files
// (so storefront pages get the x-pathname header for tenant theme resolution).
// /api/cron/* still bypasses auth — it falls into the public branch above and
// authenticates itself via CRON_SECRET at the endpoint.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|mp4|webm|woff|woff2|ttf|otf|css|js|map|txt|xml|json)$).*)",
  ],
};
