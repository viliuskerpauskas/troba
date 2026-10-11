import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth } from "./health";

describe("checkHealth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 200 with the version when the database answers", async () => {
    const result = await checkHealth("abc123", async () => undefined);

    expect(result).toEqual({
      httpStatus: 200,
      body: { status: "ok", version: "abc123", db: "ok" },
    });
  });

  it("returns 503 without error details when the database is unreachable", async () => {
    const result = await checkHealth("abc123", async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432 password=secret");
    });

    expect(result).toEqual({
      httpStatus: 503,
      body: { status: "error", version: "abc123", db: "unreachable" },
    });
    expect(JSON.stringify(result.body)).not.toMatch(/ECONNREFUSED|secret/);
  });

  it("returns 503 when the database doesn't answer within the deadline", async () => {
    vi.useFakeTimers();
    const pending = checkHealth("abc123", () => new Promise(() => {}), 2_000);

    await vi.advanceTimersByTimeAsync(2_000);

    expect(await pending).toEqual({
      httpStatus: 503,
      body: { status: "error", version: "abc123", db: "unreachable" },
    });
  });
});
