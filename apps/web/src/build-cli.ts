// Bundles the image's one-shot commands with their dependencies, so they run without
// node_modules: <outdir>/migrate.js (with the migrations copied next to it) and
// <outdir>/scripts/create-admin.js.
// Usage: node apps/web/src/build-cli.ts <outdir>
import { cp } from "node:fs/promises";
import path from "node:path";
import { migrationsFolder } from "@troba/db/migrate";
import { build } from "esbuild";

const app = path.join(import.meta.dirname, "..");

export async function buildCli(outdir: string): Promise<void> {
  await build({
    entryPoints: {
      migrate: path.join(app, "src/migrate.ts"),
      "scripts/create-admin": path.join(app, "scripts/create-admin.ts"),
    },
    outdir,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    // pg loads its optional native binding lazily; we use the pure JS client. Better Auth's
    // Next.js cookie plugin imports next/headers lazily and copes with it missing.
    external: ["pg-native", "next", "next/*"],
    // Resolves "@/..." like apps/web/tsconfig.json.
    alias: { "@": path.join(app, "src") },
    // pg is CommonJS and calls require(), which an ESM bundle doesn't have.
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: "warning",
  });
  await cp(migrationsFolder, path.join(outdir, "migrations"), { recursive: true });
}

if (import.meta.main) {
  const outdir = process.argv[2];
  if (!outdir) {
    console.error("usage: build-cli.ts <outdir>");
    process.exit(1);
  }
  await buildCli(path.resolve(outdir));
}
