import { redirect } from "next/navigation";

// Automations moved into Settings → "אוטומציות"
export default function AutomationsRedirect() {
  redirect("/admin/settings/automations");
}
