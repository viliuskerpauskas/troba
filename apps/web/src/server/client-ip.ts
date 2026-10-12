// The client's IP address, for rate limiting. In production only Caddy reaches the app, and it
// sets X-Forwarded-For to the address it saw; a client-sent X-Forwarded-For can only add entries
// in front of that one, so the last entry is the one to trust. Without a proxy, Next fills the
// header in from the socket. Null only when there's no header at all, as in direct calls.
export function clientIp(requestHeaders: Headers): string | null {
  const last = requestHeaders.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return last || null;
}
