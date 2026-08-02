import type { Metadata } from "next";
import AdminLayoutClient from "./AdminLayoutClient";

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

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
