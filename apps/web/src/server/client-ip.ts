import { isIP } from "node:net";

// The client's IP address, for rate limiting. In production only Caddy reaches the app, and it
// sets X-Forwarded-For to the address it saw; a client-sent X-Forwarded-For can only add entries
// in front of that one, so the last entry is the one to trust. Without a proxy, Next fills the
// header in from the socket. Null when there's no header, as in direct calls, or when the last
// entry isn't a bare IPv4 or IPv6 address (no brackets, port or zone id), since then it didn't
// come from Caddy. That also bounds what's stored: a bare address is at most 45 characters.
export function clientIp(requestHeaders: Headers): string | null {
  const last = requestHeaders.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  // isIP accepts a zone id (fe80::1%eth0) of any length.
  if (!last || last.includes("%")) return null;
  return isIP(last) ? last : null;
}
