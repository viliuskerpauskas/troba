// The client's IP address, for rate limiting. In production only Caddy reaches the app, and it
// sets X-Forwarded-For to the address it saw; a client-sent X-Forwarded-For can only add entries
// in front of that one, so the last entry is the one to trust. Null without the header, as in
// local development, where nothing sits in front of the app.
export function clientIp(requestHeaders: Headers): string | null {
  const last = requestHeaders.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return last || null;
}
