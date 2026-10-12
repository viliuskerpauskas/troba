import { describe, expect, it } from "vitest";
import { describeDevice } from "./user-agent";

describe("describeDevice", () => {
  it.each([
    [
      "Firefox on Windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
    ],
    [
      "Chrome on macOS",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    ],
    [
      "Edge on Windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
    ],
    [
      "Safari on iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    ],
    [
      "Safari on iPad",
      "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    ],
    [
      "Chrome on Android",
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
    ],
    ["Firefox on Linux", "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"],
    [
      "Opera on Windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 OPR/120.0.0.0",
    ],
    [
      "Chrome on iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.0.0 Mobile/15E148 Safari/604.1",
    ],
  ])("names %s", (expected, userAgent) => {
    expect(describeDevice(userAgent)).toBe(expected);
  });

  it("names the browser alone when the system is unknown", () => {
    expect(describeDevice("Mozilla/5.0 (Unknown) Firefox/140.0")).toBe("Firefox");
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["unrecognised", "curl/8.10.1"],
  ])("falls back to 'Unknown device' when the user agent is %s", (_, userAgent) => {
    expect(describeDevice(userAgent)).toBe("Unknown device");
  });
});
