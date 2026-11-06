// Whether the desktop sidebar is collapsed to icons: a display preference, read by the (app)
// layout so the first render matches, and written by the collapse button.
export const sidebarCookieName = "troba_sidebar";

export function sidebarCookie(collapsed: boolean) {
  return `${sidebarCookieName}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
}

export function isSidebarCollapsed(value: string | undefined) {
  return value === "collapsed";
}
