import path from "node:path";
import type { NextConfig } from "next";

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
    // Bank CSV uploads go through a server action: maxImportFileBytes (5 MiB) plus the form's
    // other fields. Next.js parses the body before the action runs, so this is the hard limit;
    // the action checks the file's own size.
    serverActions: { bodySizeLimit: "6mb" },
  },
  // No other site may frame troba (clickjacking on the sign-in form). A full script CSP and
  // HSTS are still to come.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
