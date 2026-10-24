import { isIP } from "node:net";

// The longest IPv6 address written out, ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255. Checked
// first, so a long header value is never parsed.
const maxAddressLength = 45;

// The client's IP address, for rate limiting. In production only Caddy reaches the app, and it
// sets X-Forwarded-For to the address it saw; a client-sent X-Forwarded-For can only add entries
// in front of that one, so the last entry is the one to trust. Without a proxy, Next fills the
// header in from the socket. Null when there's no header, as in direct calls, or when the last
// entry isn't a bare IPv4 or IPv6 address (no brackets, port or zone id), since then it didn't
// come from Caddy.
export function clientIp(requestHeaders: Headers): string | null {
  const last = requestHeaders.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (!last || last.length > maxAddressLength || last.includes("%")) return null;
  return isIP(last) ? last : null;
}
