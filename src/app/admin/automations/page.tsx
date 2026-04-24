import { redirect } from "next/navigation";

// Automations moved into Settings → "אוטומציות" tab
export default function AutomationsRedirect() {
  redirect("/admin/settings");
}
