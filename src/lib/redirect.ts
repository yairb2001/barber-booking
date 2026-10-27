import { NextResponse } from "next/server";

/** Relative redirect: the browser stays on whatever host it came in on (new domain or the old
 *  Vercel proxy). Behind our own server req.url carries the internal 0.0.0.0:3000 address,
 *  so never build a redirect from it. */
export function redirectTo(path: string, status = 302): NextResponse {
  return new NextResponse(null, { status, headers: { Location: path } });
}
