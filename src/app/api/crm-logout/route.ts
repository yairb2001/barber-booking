import { MEMBER_COOKIE } from "@/lib/crm/member-token";
import { redirectTo } from "@/lib/redirect";

/** A CRM member logs out: back to the login page. */
// A relative redirect: on our own server req.url is the internal address (27.10.2026).
export async function GET() {
  const res = redirectTo("/crm-login");
  res.cookies.set(MEMBER_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
