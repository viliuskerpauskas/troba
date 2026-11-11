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

// The model that suggests a column mapping for an unknown CSV format (ADR-0015) and categories for
// transactions (ADR-0016). The owner's choice; OPENAI_MODEL overrides it, and it must support
// structured JSON output. The worker's default, for PDF import, is core's defaultOpenAiModel: keep
// the two the same (this file stays free of core imports).
export const defaultOpenAiModel = "gpt-6-luna";

export type OpenAiConfig = { apiKey: string; model: string };

// Optional, so kept out of env(): null (no key, or an empty one from .env.example) switches the AI
// mapping off everywhere, including the sentence on the upload step that discloses it.
export function openAiConfig(): OpenAiConfig | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, model: process.env.OPENAI_MODEL?.trim() || defaultOpenAiModel };
}

// The one key switches on every AI feature; each has a name of its own so a caller says which one
// it offers.
function openAiKeySet(): boolean {
  return openAiConfig() !== null;
}

export const aiMappingEnabled = openAiKeySet;

// AI-suggested transaction categories (ADR-0016): off, the transactions list shows no button and
// says nothing about the feature.
export const aiCategorizationEnabled = openAiKeySet;

// PDF statements are read by the model (ADR-0018), so PDF import exists only with a key: without
// one, the import page doesn't offer PDF and a PDF upload is refused.
export const pdfImportEnabled = openAiKeySet;

// A daily limit from the environment: a whole number from 1 up, else the default.
function dailyLimitFrom(name: string, defaultLimit: number): number {
  const limit = Number(process.env[name]?.trim());
  return Number.isSafeInteger(limit) && limit >= 1 ? limit : defaultLimit;
}

// How many AI-suggested mappings one user gets in a day (ADR-0015), so one account can't run up the
// owner's bill. AI_MAPPING_DAILY_LIMIT overrides it; anything but a whole number from 1 up is
// ignored.
export const defaultAiMappingDailyLimit = 20;

export function aiMappingDailyLimit(): number {
  return dailyLimitFrom("AI_MAPPING_DAILY_LIMIT", defaultAiMappingDailyLimit);
}

// How many PDF statements one user can have read by AI in a day (ADR-0018), so one account can't
// run up the owner's bill. AI_PDF_IMPORT_DAILY_LIMIT overrides it; anything but a whole number from
// 1 up is ignored. The worker, which claims each use, reads it the same way through core.
export const defaultAiPdfImportDailyLimit = 10;

export function aiPdfImportDailyLimit(): number {
  return dailyLimitFrom("AI_PDF_IMPORT_DAILY_LIMIT", defaultAiPdfImportDailyLimit);
}
