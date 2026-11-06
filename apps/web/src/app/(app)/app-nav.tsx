"use client";

import {
  IconChevronRight,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconSettings,
  IconUserPlus,
  IconUsers,
  IconWallet,
  type Icon,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type ReactElement, type ReactNode, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { signOut } from "./actions";
import { breadcrumbs } from "./breadcrumbs";
import { sidebarCookie } from "./sidebar-cookie";

// The buttons' ring (button.tsx), so every focus looks the same.
const focusRing = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const navItem = cn(
  focusRing,
  "flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
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

// A sidebar item that, while the sidebar is collapsed to icons, names itself in a tooltip to
// its right on hover and keyboard focus. The tooltip is only visual: the faded label inside
// still gives the item its accessible name.
function SidebarTip({
  text,
  collapsed,
  render,
  children,
}: {
  text: string;
  collapsed: boolean;
  render: ReactElement<Record<string, unknown>>;
  children: ReactNode;
}) {
  return (
    <Tooltip disabled={!collapsed}>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} aria-hidden>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

// The app's navigation: a sidebar from md up, beside a header with the button that collapses
// it to icons and the page's breadcrumbs; on a phone, a tab bar fixed to the bottom of the
// screen with a slim top bar for the name and signing out. Only one of the two is displayed at
// a time, so the hidden one is out of the accessibility tree too. globals.css makes room for
// both through [data-app-nav]. The collapsed state is kept in a cookie, so the server renders
// the sidebar the way it was left rather than have it jump on load.
export function AppNav({
  isAdmin,
  initiallyCollapsed,
}: {
  isAdmin: boolean;
  initiallyCollapsed: boolean;
}) {
  const pathname = usePathname();
  const items = isAdmin ? [...userItems, ...adminItems] : userItems;
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const crumbs = breadcrumbs(pathname);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = sidebarCookie(next);
  }

  // Collapsing narrows the sidebar under the icons, which stay put, and fades the labels out as
  // they're clipped. A faded label is still in the accessibility tree; SidebarTip shows it.
  // The two steps run one after the other, mirrored: collapsing, the sidebar narrows and then the
  // logo's "t" moves to the middle; expanding, the "t" moves back and then the sidebar widens.
  // Moving at the same time, the "t" looks twitchy. Expanding, its move is short (100ms) and the
  // sidebar follows straight on, so opening doesn't feel held up. globals.css delays the page's
  // padding to match.
  const afterLogo = collapsed ? "delay-0" : "delay-100";
  const fade = cn(
    "transition-opacity duration-200 ease-out motion-reduce:transition-none",
    afterLogo,
    collapsed && "opacity-0",
  );
  const label = (text: string) => <span className={fade}>{text}</span>;
  const sidebarItem = cn(navItem, "overflow-hidden whitespace-nowrap");

  return (
    <TooltipProvider>
      <aside
        id="app-sidebar"
        data-app-nav
        data-collapsed={collapsed || undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-10 hidden flex-col gap-6 overflow-hidden border-r bg-background px-2 py-3 transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex",
          // 13 is the icons (size-5) with their padding on each side, so they keep their place.
          collapsed ? "w-13" : "w-56",
          afterLogo,
        )}
      >
        <Link href="/money" className={cn(focusRing, "rounded-md px-2 font-heading text-2xl")}>
          {/* Tracks: space, "t", "roba", space. Collapsing hands the space "roba" took to the
              two around the "t", centering it; fr values animate, so it slides there. The grid
              is on a span because the global transition rule for links in globals.css would
              override its transition-property. */}
          <span
            className={cn(
              "grid transition-[grid-template-columns] ease-out motion-reduce:transition-none",
              // Collapsing, the "t" waits for the sidebar to finish narrowing; expanding, it goes
              // first (see afterLogo).
              collapsed
                ? "grid-cols-[minmax(0,1fr)_auto_minmax(0,0fr)_minmax(0,1fr)] delay-200 duration-200"
                : "grid-cols-[minmax(0,0fr)_auto_minmax(0,1fr)_minmax(0,0fr)] duration-100",
            )}
          >
            <span className="col-start-2">t</span>
            <span className={cn(fade, "col-start-3 overflow-hidden whitespace-nowrap")}>roba</span>
          </span>
        </Link>
        <nav className="flex flex-col gap-1">
          {items.map(({ href, label: text, icon: ItemIcon }) => {
            const active = isActive(pathname, href);
            return (
              <SidebarTip
                key={href}
                text={text}
                collapsed={collapsed}
                render={
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(sidebarItem, active && "bg-muted text-foreground")}
                  />
                }
              >
                <ItemIcon className="size-5 shrink-0" aria-hidden />
                {label(text)}
              </SidebarTip>
            );
          })}
        </nav>
        <form action={signOut} className="mt-auto">
          <SidebarTip
            text="Sign out"
            collapsed={collapsed}
            render={<button type="submit" className={cn(sidebarItem, "w-full")} />}
          >
            <IconLogout className="size-5 shrink-0" aria-hidden />
            {label("Sign out")}
          </SidebarTip>
        </form>
      </aside>

      <header className="sticky top-0 z-[5] hidden h-12 items-center gap-2 border-b bg-background px-2 md:flex">
        <button
          type="button"
          onClick={toggle}
          aria-controls="app-sidebar"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            focusRing,
            "rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {collapsed ? (
            <IconLayoutSidebarLeftExpand className="size-5" aria-hidden />
          ) : (
            <IconLayoutSidebarLeftCollapse className="size-5" aria-hidden />
          )}
        </button>
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex items-center gap-1 text-sm text-muted-foreground">
              {crumbs.map((crumb, index) => {
                const current = index === crumbs.length - 1;
                return (
                  <Fragment key={crumb.href}>
                    {index > 0 && (
                      <li aria-hidden className="flex">
                        <IconChevronRight className="size-4" />
                      </li>
                    )}
                    <li className="min-w-0 truncate">
                      {current ? (
                        <span aria-current="page" className="text-foreground">
                          {crumb.label}
                        </span>
                      ) : (
                        <Link
                          href={crumb.href}
                          className={cn(focusRing, "rounded-sm hover:text-foreground")}
                        >
                          {crumb.label}
                        </Link>
                      )}
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          </nav>
        )}
      </header>

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
        {items.map(({ href, label: text, icon: ItemIcon }) => {
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
              {text}
            </Link>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}
