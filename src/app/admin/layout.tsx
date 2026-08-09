import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import AdminLayoutClient from "./AdminLayoutClient";
import { verifySession, COOKIE_NAME } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Server wrapper whose only job is admin-specific metadata — a "use client"
// component (AdminLayoutClient) can't export `metadata` itself. Points
// "Add to Home Screen" at the admin manifest (src/app/admin/manifest.ts)
// and gives it a distinct iOS home-screen title, instead of inheriting the
// customer-oriented ones from the root layout.
export const metadata: Metadata = {
  manifest: "/admin/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "DOMINANT ניהול",
    statusBarStyle: "default",
  },
};

// A staff session's JWT stays valid for 30 days regardless of DB state (so
// active staff never have to re-login constantly) — but a barber removed
// from the business (isActive:false) shouldn't get to keep using an already
// open session until that token expires. This runs on every /admin page
// load (Node runtime, unlike middleware.ts which is Edge and can't reach
// Prisma) and kicks a removed barber back to login on their very next
// navigation/reload. It does NOT touch owner sessions (no staffId) or other
// active staff — zero effect on how often anyone else needs to log in.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = headers().get("x-pathname") || "";
  if (pathname !== "/admin/login") {
    const token = cookies().get(COOKIE_NAME)?.value;
    const session = await verifySession(token);
    if (session?.staffId) {
      const staff = await prisma.staff.findUnique({ where: { id: session.staffId }, select: { isActive: true } });
      if (!staff || !staff.isActive) {
        redirect("/admin/login");
      }
    }
  }
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
