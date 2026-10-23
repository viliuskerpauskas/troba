import { type NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy } from "@/server/csp";

// A fresh nonce for every page request. Next reads the policy from the request headers and puts
// its nonce on the scripts it renders, which is why pages render per request: the root layout's
// connection() call keeps them dynamic. A static page would carry no nonce, and 'strict-dynamic'
// would block all its scripts.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy({ nonce, dev: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  return response;
}

// Static files, API routes and prefetches carry no inline scripts; they keep the nonce-less
// policy from next.config.ts.
export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
