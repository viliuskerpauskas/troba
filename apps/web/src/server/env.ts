import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

// Validated lazily so `next build` doesn't need a database URL.
export function env(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}

// Kept out of env() so /api/health can report the version even when the rest of the env is broken.
export function gitSha(): string {
  return process.env.GIT_SHA || "dev";
}
