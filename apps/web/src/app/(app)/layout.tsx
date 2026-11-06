import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { currentUser } from "@/server/session";
import { AppNav } from "./app-nav";
import { isSidebarCollapsed, sidebarCookieName } from "./sidebar-cookie";

// Pages under (app) are for signed-in users. Each page calls requireUser() itself: a layout
// doesn't re-render on every navigation, so it can't be the only check. The role here only
// decides which links to show.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  const collapsed = isSidebarCollapsed((await cookies()).get(sidebarCookieName)?.value);

  return (
    <>
      <AppNav isAdmin={user?.role === "admin"} initiallyCollapsed={collapsed} />
      <div className="center-on-viewport">{children}</div>
    </>
  );
}
