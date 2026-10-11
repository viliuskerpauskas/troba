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
};

export default nextConfig;
