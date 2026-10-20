import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/session";

// Checked here too, so non-admins get 403 rather than a redirect to a page that refuses them.
export default async function AdminPage() {
  await requireAdmin();
  redirect("/admin/users");
}
