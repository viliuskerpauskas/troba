import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./csp";

function directives(policy: string) {
  return Object.fromEntries(
    policy.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(" ");
      return [name, sources];
    }),
  );
}

describe("contentSecurityPolicy", () => {
  it("starts from default-src 'self' and keeps framing blocked", () => {
    const policy = contentSecurityPolicy({ nonce: "abc", dev: false });

    expect(policy.startsWith("default-src 'self';")).toBe(true);
    expect(directives(policy)).toMatchObject({
      "frame-ancestors": ["'none'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
    });
  });

  it("lets only scripts carrying the request's nonce run, and what they load", () => {
    const policy = contentSecurityPolicy({ nonce: "abc", dev: false });

    expect(directives(policy)["script-src"]).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
  });

  it("allows eval only in development, where React needs it", () => {
    expect(contentSecurityPolicy({ nonce: "abc", dev: false })).not.toContain("unsafe-eval");
    expect(directives(contentSecurityPolicy({ nonce: "abc", dev: true }))["script-src"]).toContain(
      "'unsafe-eval'",
    );
  });

  it("without a nonce, allows no inline script at all", () => {
    const policy = contentSecurityPolicy({ dev: false });

    expect(directives(policy)["script-src"]).toEqual(["'self'"]);
  });
});
