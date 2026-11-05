"use client";

import {
  IconLogout,
  IconSettings,
  IconUserPlus,
  IconUsers,
  IconWallet,
  type Icon,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { signOut } from "./actions";

// The buttons' ring (button.tsx), so every focus looks the same.
const focusRing = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const navItem = cn(
  focusRing,
  "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
);

type NavItem = { href: string; label: string; icon: Icon };

const userItems: NavItem[] = [
  { href: "/money", label: "Money", icon: IconWallet },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

const adminItems: NavItem[] = [
  { href: "/admin/users", label: "Users", icon: IconUsers },
  { href: "/admin/invites", label: "Invites", icon: IconUserPlus },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// The app's navigation: a sidebar from md up, and on a phone a tab bar fixed to the bottom of
// the screen with a slim top bar for the name and signing out. Only one of the two is displayed
// at a time, so the hidden one is out of the accessibility tree too. globals.css makes room for
// both through [data-app-nav].
export function AppNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? [...userItems, ...adminItems] : userItems;

  return (
    <>
      <aside
        data-app-nav
        className="fixed inset-y-0 left-0 z-10 hidden w-56 flex-col gap-6 border-r bg-background px-3 py-5 md:flex"
      >
        <Link href="/money" className={cn(focusRing, "rounded-md px-3 font-heading text-2xl")}>
          troba
        </Link>
        <nav className="flex flex-col gap-1">
          {items.map(({ href, label, icon: ItemIcon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(navItem, active && "bg-muted text-foreground")}
              >
                <ItemIcon className="size-5" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
        <form action={signOut} className="mt-auto">
          <button type="submit" className={cn(navItem, "w-full")}>
            <IconLogout className="size-5" aria-hidden />
            Sign out
          </button>
        </form>
      </aside>

      <header className="flex items-center justify-between border-b px-4 py-2 md:hidden">
        <Link href="/money" className={cn(focusRing, "rounded-md font-heading text-xl")}>
          troba
        </Link>
        <form action={signOut}>
          <button type="submit" className={cn(navItem, "gap-1.5 px-2 py-1")}>
            <IconLogout className="size-4" aria-hidden />
            Sign out
          </button>
        </form>
      </header>

      <nav
        data-app-nav
        className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {items.map(({ href, label, icon: ItemIcon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                focusRing,
                "flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs text-muted-foreground",
                active && "text-foreground",
              )}
            >
              <ItemIcon className="size-6" stroke={active ? 2.25 : 1.75} aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
