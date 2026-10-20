import Link from "next/link";
import type { ReactNode } from "react";
import { currentUser } from "@/server/session";
import { signOut } from "./actions";

// Pages under (app) are for signed-in users. Each page calls requireUser() itself: a layout
// doesn't re-render on every navigation, so it can't be the only check. The role here only
// decides which links to show.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();

  return (
    <>
      <header>
        <nav>
          <Link href="/money">Money</Link> <Link href="/settings">Settings</Link>
          {user?.role === "admin" && (
            <>
              {" "}
              <Link href="/admin/users">Users</Link> <Link href="/admin/invites">Invites</Link>
            </>
          )}
        </nav>
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </header>
      {children}
    </>
  );
}
