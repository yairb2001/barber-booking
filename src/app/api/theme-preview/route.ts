import { NextRequest } from "next/server";
import { THEMES, THEME_PREVIEW_COOKIE } from "@/lib/themes";
import { redirectTo } from "@/lib/redirect";

// /api/theme-preview?id=dominant → this browser sees that preset on the customer
// pages (home + booking) for a week; ?id=off → back to the saved theme.
// Only the visitor's own view changes, so no auth is needed.
export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  const res = redirectTo("/", 307);
  if (id && id in THEMES) res.cookies.set(THEME_PREVIEW_COOKIE, id, { path: "/", maxAge: 7 * 86400, sameSite: "lax" });
  else res.cookies.delete(THEME_PREVIEW_COOKIE);
  return res;
}
