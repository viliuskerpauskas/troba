// The Content-Security-Policy, as the Next.js CSP guide sets it up. Pages get a fresh nonce per
// request from src/proxy.ts, which Next puts on its own scripts; 'strict-dynamic' then trusts
// what those load. Responses the proxy skips (static files, API routes, prefetches) get the
// policy without a nonce from next.config.ts, so no inline script runs there at all.
//
// Styles allow 'unsafe-inline': React renders style attributes (charts, column widths) into the
// server HTML, and a nonce can't cover attributes. Scripts are the injection risk this guards.
// Development needs 'unsafe-eval' for React's debugging tools; production never sends it.
export function contentSecurityPolicy({ nonce, dev }: { nonce?: string; dev: boolean }): string {
  const scriptSrc = ["'self'"];
  if (nonce) scriptSrc.push(`'nonce-${nonce}'`, "'strict-dynamic'");
  if (dev) scriptSrc.push("'unsafe-eval'");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
