import { describe, expect, it } from "vitest";
import { describeIpAddress } from "./ip-address";

describe("describeIpAddress", () => {
  it("shows an IPv4 address as it is", () => {
    expect(describeIpAddress("203.0.113.7")).toBe("203.0.113.7");
  });

  // Better Auth stores an IPv6 address as its /64, written out in full with the rest zeroed.
  it("shows a stored IPv6 address as its /64 network, compressed", () => {
    expect(describeIpAddress("2001:0db8:0000:0001:0000:0000:0000:0000")).toBe("2001:db8:0:1::/64");
  });

  it("shows nothing when Better Auth couldn't tell the address", () => {
    expect(describeIpAddress("")).toBeNull();
    expect(describeIpAddress(null)).toBeNull();
  });
});
