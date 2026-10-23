import path from "node:path";
import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./src/server/csp";

const root = path.join(import.meta.dirname, "../..");

// Env files live at the repo root, shared with compose and the db scripts. Real env vars win,
// then .env; outside production, .env.example fills in the local defaults.
loadEnvFile(path.join(root, ".env"));
if (process.env.NODE_ENV !== "production") loadEnvFile(path.join(root, ".env.example"));

function loadEnvFile(file: string) {
  try {
    process.loadEnvFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Trace workspace packages from the monorepo root into the standalone bundle.
  outputFileTracingRoot: root,
  transpilePackages: ["@troba/core", "@troba/db"],
  experimental: {
    // forbidden() and unauthorized() from next/navigation, used by requireUser/requireAdmin.
    authInterrupts: true,
    // Uploads go through server actions: receipts are up to maxAttachmentBytes (10 MiB), bank
    // CSVs maxImportFileBytes (5 MiB), plus the form's other fields. Next.js parses the body
    // before the action runs, so this is the hard limit; each action checks the file's own size.
    serverActions: { bodySizeLimit: "11mb" },
  },
  // No other site may frame troba (clickjacking on the sign-in form), and no injected script
  // runs. Pages replace this CSP with one carrying a per-request nonce (src/proxy.ts).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy({ dev: process.env.NODE_ENV === "development" }),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Caddy terminates TLS and sets X-Forwarded-Proto. Over plain HTTP browsers ignore HSTS,
        // so a client sending the header itself gains nothing.
        source: "/:path*",
        has: [{ type: "header", key: "x-forwarded-proto", value: "https" }],
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
