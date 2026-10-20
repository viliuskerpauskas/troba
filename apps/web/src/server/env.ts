import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Signs and encrypts session cookies. Generate one with `openssl rand -base64 32`.
  BETTER_AUTH_SECRET: z.string().min(32),
  // The public origin users reach the app at, e.g. https://troba.example.
  BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

// Validated lazily so `next build` doesn't need a database URL.
export function env(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}

// Users' files, one folder per user: <UPLOADS_DIR>/<userId>/. A relative path (the local default)
// is resolved against the repo root, so next dev, the e2e server and tests share one folder
// whatever their working directory. The Docker image sets an absolute path. Kept out of env() so
// the admin CLI, which never touches files, doesn't need it.
export function uploadsDir(): string {
  const dir = z
    .string()
    .min(1, { error: "UPLOADS_DIR is not set." })
    .parse(process.env.UPLOADS_DIR);
  return path.isAbsolute(dir) ? dir : path.resolve(repoRoot(), dir);
}

// Walks up from the working directory, not from import.meta.dirname as the config files do: Next
// bundles this module under .next, so its own location differs between dev and the standalone
// build. The standalone server runs inside .next/standalone, which has no pnpm-workspace.yaml, so
// the walk carries on to the repo.
function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    if (path.dirname(dir) === dir) break;
  }
  throw new Error("UPLOADS_DIR is relative and no repo root was found; set an absolute path.");
}

// Kept out of env() so /api/health can report the version even when the rest of the env is broken.
export function gitSha(): string {
  return process.env.GIT_SHA || "dev";
}
