// Bundles the worker with its dependencies into <outdir>/worker.js, so the image runs it without
// node_modules, and so Node runs packages/core (whose imports have no file extensions).
// Usage: node apps/worker/scripts/build.ts <outdir>
import path from "node:path";
import { build, type BuildOptions } from "esbuild";

const app = path.join(import.meta.dirname, "..");

export function workerBuildOptions(outdir: string) {
  return {
    entryPoints: [path.join(app, "src/main.ts")],
    outfile: path.join(outdir, "worker.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    // pg loads its optional native binding lazily; we use the pure JS client.
    external: ["pg-native"],
    // pg is CommonJS and calls require(), which an ESM bundle doesn't have.
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: "warning",
  } satisfies BuildOptions;
}

if (import.meta.main) {
  const outdir = process.argv[2];
  if (!outdir) {
    console.error("usage: build.ts <outdir>");
    process.exit(1);
  }
  await build(workerBuildOptions(path.resolve(outdir)));
}
