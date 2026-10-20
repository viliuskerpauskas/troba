import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadsDir } from "./env";

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
