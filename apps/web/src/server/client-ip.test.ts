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
    ["an IPv4 address", "203.0.113.9"],
    ["an IPv4-mapped IPv6 address", "::ffff:198.51.100.7"],
    ["the longest way to write an IPv6 address", "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255"],
  ])("reads %s", (_, address) => {
    expect(clientIp(new Headers({ "x-forwarded-for": address }))).toBe(address);
  });

  it.each([
    ["no header", new Headers()],
    ["an empty header", new Headers({ "x-forwarded-for": " " })],
    // Only Caddy reaches the app in production, so a last entry that isn't an address came from
    // somewhere else and isn't stored.
    ["a last entry that isn't an address", new Headers({ "x-forwarded-for": "unknown" })],
    ["a bracketed IPv6 address", new Headers({ "x-forwarded-for": "[2001:db8::1]" })],
    ["an address with a port", new Headers({ "x-forwarded-for": "203.0.113.9:443" })],
    [
      "a bracketed IPv6 address with a port",
      new Headers({ "x-forwarded-for": "[2001:db8::1]:443" }),
    ],
    // Caddy writes a bare address, and the sign-in limit's IPv6 /64 key assumes one.
    ["an IPv6 address with a zone id", new Headers({ "x-forwarded-for": "fe80::1%eth0" })],
    [
      "an over-long last entry",
      new Headers({ "x-forwarded-for": `2001:db8:${"0:".repeat(300)}1` }),
    ],
  ])("returns null for %s", (_, headers) => {
    expect(clientIp(headers)).toBeNull();
  });
});
