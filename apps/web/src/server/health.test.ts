import { describe, expect, it } from "vitest";
import { checkHealth } from "./health";

describe("checkHealth", () => {
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
});
