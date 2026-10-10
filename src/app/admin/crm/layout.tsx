import type { Metadata } from "next";
import CrmShell from "./CrmShell";

// Server wrapper for the CRM's own "Add to Home Screen" (10.10.2026: a shortcut
// from the phone's home screen straight into the CRM). The CRM stays a tab of
// the management app; this only points the install at a manifest whose
// start_url is /admin/crm (see ../manifest.webmanifest for why it is a route).
export const metadata: Metadata = {
  manifest: "/admin/crm/manifest.webmanifest",
  appleWebApp: { capable: true, title: "CRM", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/chator/crm-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/chator/crm-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/chator/crm-apple-touch-icon.png",
  },
};

// @modal: a lead or customer card opened from inside the CRM shows as a sheet
// over the current screen (intercepted routes, CardModal.tsx).
export default function CrmLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  return <CrmShell>{children}{modal}</CrmShell>;
}
