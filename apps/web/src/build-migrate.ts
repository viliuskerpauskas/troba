// Bundles migrate.ts with its dependencies into <outdir>/migrate.js and copies the migrations
// next to it, so the image can run `node migrate.js` without node_modules.
// Usage: node apps/web/src/build-migrate.ts <outdir>
import { cp } from "node:fs/promises";
import path from "node:path";
import { migrationsFolder } from "@troba/db/migrate";
import { build } from "esbuild";

export async function buildMigrate(outdir: string): Promise<void> {
  await build({
    entryPoints: [path.join(import.meta.dirname, "migrate.ts")],
    outfile: path.join(outdir, "migrate.js"),
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
    // Bundled modules all share the entry's import.meta.main, so the db package's own CLI block
    // would run too. The entry doesn't check it.
    define: { "import.meta.main": "false" },
    logLevel: "warning",
  });
  await cp(migrationsFolder, path.join(outdir, "migrations"), { recursive: true });
}

if (import.meta.main) {
  const outdir = process.argv[2];
  if (!outdir) {
    console.error("usage: build-migrate.ts <outdir>");
    process.exit(1);
  }
  await buildMigrate(path.resolve(outdir));
}
