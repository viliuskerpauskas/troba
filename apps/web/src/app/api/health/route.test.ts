import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@troba/db", () => ({
  createDb: vi.fn(() => ({})),
  pingDb: vi.fn(),
}));

// Fresh modules per test: env and the db pool are cached per process.
async function loadRoute() {
  vi.resetModules();
  const [{ GET }, { pingDb }] = await Promise.all([import("./route"), import("@troba/db")]);
  return { GET, pingDb: vi.mocked(pingDb) };
}

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.stubEnv("GIT_SHA", "abc123");
    vi.stubEnv("DATABASE_URL", "postgres://user:pw@localhost:5432/db");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as { trobaDb?: unknown }).trobaDb;
  });

  it("answers 200 with the version, uncached, when the database answers", async () => {
    const { GET, pingDb } = await loadRoute();
    pingDb.mockResolvedValue(undefined);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", version: "abc123", db: "ok" });
  });

  it("answers 503 when the database is unreachable", async () => {
    const { GET, pingDb } = await loadRoute();
    pingDb.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      version: "abc123",
      db: "unreachable",
    });
  });

  it("answers 503, not 500, when DATABASE_URL is missing", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    const { GET } = await loadRoute();

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      version: "abc123",
      db: "unreachable",
    });
  });
});
