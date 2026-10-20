import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@troba/db", () => ({
  createDb: vi.fn(() => ({})),
  pingDb: vi.fn(),
}));

// Fresh modules per test: env and the db pool are cached per process. The vi.mock factory's result
// survives the reset, so every test shares one pingDb; the clearMocks default clears its calls.
// The imports run one after the other: vitest's mocker can hand the real module to one of two
// concurrent imports of a mocked module, so a Promise.all here made the route ping a real database
// now and then.
async function loadRoute() {
  vi.resetModules();
  const { GET } = await import("./route");
  const { pingDb } = await import("@troba/db");
  return { GET, pingDb: vi.mocked(pingDb) };
}

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.stubEnv("GIT_SHA", "abc123");
    // Every variable env() validates, so the test doesn't lean on .env.example.
    vi.stubEnv("DATABASE_URL", "postgres://user:pw@localhost:5432/db");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-that-is-at-least-32-characters");
    vi.stubEnv("BETTER_AUTH_URL", "https://troba.example.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as { trobaDb?: unknown }).trobaDb;
  });

  it("answers 200 with the version, uncached, when the database answers", async () => {
    const { GET, pingDb } = await loadRoute();
    pingDb.mockResolvedValue(undefined);

    const response = await GET();

    expect(pingDb).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", version: "abc123", db: "ok" });
  });

  it("answers 503 when the database is unreachable", async () => {
    const { GET, pingDb } = await loadRoute();
    pingDb.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const response = await GET();

    expect(pingDb).toHaveBeenCalledOnce();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      version: "abc123",
      db: "unreachable",
    });
  });

  it("answers 503, not 500, when DATABASE_URL is missing", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    const { GET, pingDb } = await loadRoute();

    const response = await GET();

    // db() threw before any ping.
    expect(pingDb).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      version: "abc123",
      db: "unreachable",
    });
  });
});
