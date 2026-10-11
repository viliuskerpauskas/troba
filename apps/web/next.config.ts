import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Trace workspace packages from the monorepo root into the standalone bundle.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@troba/core"],
};

export default nextConfig;
