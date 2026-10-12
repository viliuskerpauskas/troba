import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "./actions";

// Pages under (app) are for signed-in users. Each page calls requireUser() itself: a layout
// doesn't re-render on every navigation, so it can't be the only check.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header>
        <nav>
          <Link href="/money">Money</Link> <Link href="/settings">Settings</Link>
        </nav>
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </header>
      {children}
    </>
  );
}
