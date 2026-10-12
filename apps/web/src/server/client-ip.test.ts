import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

describe("clientIp", () => {
  it("takes the address the proxy in front of troba added: the last X-Forwarded-For entry", () => {
    // A client can send its own X-Forwarded-For; only the last entry comes from Caddy.
    const headers = new Headers({ "x-forwarded-for": "198.51.100.7, 203.0.113.9" });

    expect(clientIp(headers)).toBe("203.0.113.9");
  });

  it("reads a single address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 2001:db8::1 " }))).toBe("2001:db8::1");
  });

  it.each([
    ["no header", new Headers()],
    ["an empty header", new Headers({ "x-forwarded-for": " " })],
  ])("returns null for %s", (_, headers) => {
    expect(clientIp(headers)).toBeNull();
  });
});
