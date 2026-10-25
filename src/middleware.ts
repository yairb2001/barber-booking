import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { verifySession, COOKIE_NAME } from "@/lib/auth";
import { MEMBER_COOKIE, verifyMemberToken, isMemberPath } from "@/lib/crm/member-token";

// A barber with "👑 גישה מלאה" logs in as owner (Staff.role "owner"). His cookie
// lives 30 days, so the role is re-checked against the DB (cached 60s per
// instance) — switching it off takes effect within a minute. Fails closed.
const fullAccessCache = new Map<string, { owner: boolean; at: number }>();
async function staffStillOwner(req: NextRequest, staffId: string): Promise<boolean> {
  const hit = fullAccessCache.get(staffId);
  if (hit && Date.now() - hit.at < 60_000) return hit.owner;
  try {
    const key = await new SignJWT({ type: "staff_role_check", staffId }).setProtectedHeader({ alg: "HS256" })
      .setIssuedAt().setExpirationTime("60s").sign(new TextEncoder().encode(process.env.AUTH_SECRET || ""));
    const r = await fetch(new URL(`/api/internal/staff-role`, req.url), { headers: { "x-internal-key": key }, cache: "no-store" });
    const owner = r.ok ? !!(await r.json()).owner : false;
    fullAccessCache.set(staffId, { owner, at: Date.now() });
    return owner;
  } catch { return false; }
}

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
  requestHeaders.delete("x-crm-member-id");

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

  // A reports-only CRM member (25.10.2026): its own cookie, and only the reports
  // screen and the CRM API, where every view and action is checked again. Set
  // even when a shop's admin session exists in the same browser.
  const memberId = pathname.startsWith("/admin/crm") || isMemberPath(pathname) ? await verifyMemberToken(req.cookies.get(MEMBER_COOKIE)?.value) : null;
  if (memberId && isMemberPath(pathname)) requestHeaders.set("x-crm-member-id", memberId);

  if (!session) {
    if (memberId && isMemberPath(pathname)) return NextResponse.next({ request: { headers: requestHeaders } });
    // Elsewhere in the CRM (the home-screen shortcut opens /admin/crm): to her reports, not the admin login.
    if (memberId && pathname.startsWith("/admin/crm")) return NextResponse.redirect(new URL("/admin/crm/reports", req.url));
    if (pathname.startsWith("/api/admin")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = pathname.startsWith("/admin/crm/reports") ? "/crm-login" : "/admin/login";
    // Back to where they were going after login — e.g. the CRM's home-screen
    // shortcut opens logged out (iOS gives each home-screen app its own cookies).
    url.search = "";
    if (pathname !== "/admin") url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // Pass session info to API route handlers via request headers
  requestHeaders.set("x-session-business-id", session.businessId);
  const role = session.role === "owner" && session.staffId && !(await staffStillOwner(req, session.staffId)) ? "barber" : session.role;
  requestHeaders.set("x-session-role", role);
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
    "/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|mp4|webm|woff|woff2|ttf|otf|css|js|map|txt|xml|json|webmanifest)$).*)",
  ],
};
