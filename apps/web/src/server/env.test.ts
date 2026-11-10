import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiCategorizationEnabled,
  aiCategorizeDailyLimit,
  aiMappingDailyLimit,
  aiMappingEnabled,
  aiPdfImportDailyLimit,
  defaultAiCategorizeDailyLimit,
  defaultAiMappingDailyLimit,
  defaultAiPdfImportDailyLimit,
  defaultOpenAiModel,
  openAiConfig,
  uploadsDir,
} from "./env";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");

// process.chdir works in vitest's default forks pool, not in worker threads.
describe("uploadsDir", () => {
  const cwd = process.cwd();

  beforeEach(() => {
    vi.stubEnv("UPLOADS_DIR", "uploads");
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.unstubAllEnvs();
  });

  it("resolves a relative path against the repo root whatever the working directory", () => {
    process.chdir(repoRoot);
    const fromRoot = uploadsDir();
    process.chdir(path.join(repoRoot, "apps/web"));
    const fromWeb = uploadsDir();

    expect(fromRoot).toBe(path.join(repoRoot, "uploads"));
    expect(fromWeb).toBe(path.join(repoRoot, "uploads"));
  });

  it("returns an absolute path as it is, even outside the repo", () => {
    const absolute = path.join(tmpdir(), "troba-uploads");
    vi.stubEnv("UPLOADS_DIR", absolute);
    process.chdir(tmpdir());

    expect(uploadsDir()).toBe(absolute);
  });

  it("refuses a relative path when the working directory is outside the repo", () => {
    process.chdir(tmpdir());

    expect(() => uploadsDir()).toThrow(/absolute path/);
  });
});

describe("openAiConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is null, and the feature off, while no key is set", () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    expect(openAiConfig()).toBeNull();
    expect(aiMappingEnabled()).toBe(false);
    expect(aiCategorizationEnabled()).toBe(false);
  });

  it("treats an empty or blank key as not set", () => {
    vi.stubEnv("OPENAI_API_KEY", "  ");
    expect(openAiConfig()).toBeNull();
  });

  it("takes the model from OPENAI_MODEL, else the default", () => {
    vi.stubEnv("OPENAI_API_KEY", " sk-test ");
    vi.stubEnv("OPENAI_MODEL", "");
    expect(openAiConfig()).toEqual({ apiKey: "sk-test", model: defaultOpenAiModel });
    expect(aiMappingEnabled()).toBe(true);
    expect(aiCategorizationEnabled()).toBe(true);

    vi.stubEnv("OPENAI_MODEL", "other-model");
    expect(openAiConfig()?.model).toBe("other-model");
  });
});

describe("aiMappingDailyLimit", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is 20 a day unless AI_MAPPING_DAILY_LIMIT says otherwise", () => {
    vi.stubEnv("AI_MAPPING_DAILY_LIMIT", undefined);
    expect(defaultAiMappingDailyLimit).toBe(20);
    expect(aiMappingDailyLimit()).toBe(20);

    vi.stubEnv("AI_MAPPING_DAILY_LIMIT", " 5 ");
    expect(aiMappingDailyLimit()).toBe(5);
  });

  it.each(["", "0", "-3", "2.5", "many", "1e999"])("ignores %j", (value) => {
    vi.stubEnv("AI_MAPPING_DAILY_LIMIT", value);
    expect(aiMappingDailyLimit()).toBe(20);
  });
});

describe("aiCategorizeDailyLimit", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is 200 merchants a day unless AI_CATEGORIZE_DAILY_LIMIT says otherwise", () => {
    vi.stubEnv("AI_CATEGORIZE_DAILY_LIMIT", undefined);
    expect(defaultAiCategorizeDailyLimit).toBe(200);
    expect(aiCategorizeDailyLimit()).toBe(200);

    vi.stubEnv("AI_CATEGORIZE_DAILY_LIMIT", " 50 ");
    expect(aiCategorizeDailyLimit()).toBe(50);
  });

  it.each(["", "0", "-3", "2.5", "many", "1e999"])("ignores %j", (value) => {
    vi.stubEnv("AI_CATEGORIZE_DAILY_LIMIT", value);
    expect(aiCategorizeDailyLimit()).toBe(200);
  });
});

describe("aiPdfImportDailyLimit", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is 10 PDF imports a day unless AI_PDF_IMPORT_DAILY_LIMIT says otherwise", () => {
    vi.stubEnv("AI_PDF_IMPORT_DAILY_LIMIT", undefined);
    expect(defaultAiPdfImportDailyLimit).toBe(10);
    expect(aiPdfImportDailyLimit()).toBe(10);

    vi.stubEnv("AI_PDF_IMPORT_DAILY_LIMIT", " 3 ");
    expect(aiPdfImportDailyLimit()).toBe(3);
  });

  it.each(["", "0", "-3", "2.5", "many", "1e999"])("ignores %j", (value) => {
    vi.stubEnv("AI_PDF_IMPORT_DAILY_LIMIT", value);
    expect(aiPdfImportDailyLimit()).toBe(10);
  });
});
