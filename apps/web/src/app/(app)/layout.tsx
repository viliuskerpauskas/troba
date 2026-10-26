import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/server/session";
import { signOut } from "./actions";

const navLink =
  "rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground";

// Pages under (app) are for signed-in users. Each page calls requireUser() itself: a layout
// doesn't re-render on every navigation, so it can't be the only check. The role here only
// decides which links to show.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();

  return (
    <>
      <header className="border-b">
        {/* The links wrap onto a second line on a phone, so no menu hides them. */}
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-4 py-2">
          <nav className="flex flex-wrap items-center gap-1">
            <Link href="/money" className={navLink}>
              Money
            </Link>
            <Link href="/settings" className={navLink}>
              Settings
            </Link>
            {user?.role === "admin" && (
              <>
                <Link href="/admin/users" className={navLink}>
                  Users
                </Link>
                <Link href="/admin/invites" className={navLink}>
                  Invites
                </Link>
              </>
            )}
          </nav>
          <form action={signOut} className="ml-auto">
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
