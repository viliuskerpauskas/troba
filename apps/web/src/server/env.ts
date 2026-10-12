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

// Users' files, one folder per user: <UPLOADS_DIR>/<userId>/. A relative path is resolved against
// the working directory. Kept out of env() so the admin CLI, which never touches files, doesn't
// need it.
export function uploadsDir(): string {
  return z.string().min(1, { error: "UPLOADS_DIR is not set." }).parse(process.env.UPLOADS_DIR);
}

// Kept out of env() so /api/health can report the version even when the rest of the env is broken.
export function gitSha(): string {
  return process.env.GIT_SHA || "dev";
}
