import { MutableRequestCookiesAdapter } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { RequestCookies, type ResponseCookies } from "next/dist/server/web/spec-extension/cookies";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

const sessionCookie = "__Secure-better-auth.session_token";
const requestHeaders = new Headers({
  cookie: `${sessionCookie}=old.sig%2B%3D; theme=dark; stale=1`,
  "user-agent": "test",
});
// What cookies() returns: a page render reads the request's cookies; a server action gets a
// mutable jar whose toString() is Set-Cookie syntax, so tests use the real Next classes.
let jar: RequestCookies | ResponseCookies = new RequestCookies(requestHeaders);

vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => jar,
}));
// The real functions throw special errors that Next turns into a redirect, 401 or 403.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  unauthorized: () => {
    throw new Error("unauthorized");
  },
  forbidden: () => {
    throw new Error("forbidden");
  },
}));
vi.mock("./auth", () => ({ auth: () => ({ api: { getSession } }) }));

const { authHeaders, requireAdmin, requireUser } = await import("./session");

function sessionFor(user: { role?: string | null; banned?: boolean | null }) {
  return { session: { id: "s1" }, user: { id: "u1", ...user } };
}

describe("requireUser", () => {
  beforeEach(() => getSession.mockReset());

  it("returns the user id and role for a signed-in user", async () => {
    getSession.mockResolvedValue(sessionFor({ role: "user", banned: false }));

    await expect(requireUser()).resolves.toEqual({ userId: "u1", role: "user" });
  });

  it("redirects pages and actions to /sign-in without a session", async () => {
    getSession.mockResolvedValue(null);

    await expect(requireUser()).rejects.toThrow("redirect:/sign-in");
  });

  it("responds 401 to API callers without a session", async () => {
    getSession.mockResolvedValue(null);

    await expect(requireUser("api")).rejects.toThrow("unauthorized");
  });

  it("treats a banned user as signed out", async () => {
    getSession.mockResolvedValue(sessionFor({ role: "user", banned: true }));

    await expect(requireUser()).rejects.toThrow("redirect:/sign-in");
    await expect(requireUser("api")).rejects.toThrow("unauthorized");
  });

  it("treats an unknown role as the least privileged one", async () => {
    getSession.mockResolvedValue(sessionFor({ role: "superuser" }));

    await expect(requireUser()).resolves.toEqual({ userId: "u1", role: "user" });
  });
});

describe("requireAdmin", () => {
  beforeEach(() => getSession.mockReset());

  it("returns an admin", async () => {
    getSession.mockResolvedValue(sessionFor({ role: "admin" }));

    await expect(requireAdmin()).resolves.toEqual({ userId: "u1", role: "admin" });
  });

  it("responds 403 to a signed-in non-admin", async () => {
    getSession.mockResolvedValue(sessionFor({ role: "user" }));

    await expect(requireAdmin()).rejects.toThrow("forbidden");
    await expect(requireAdmin("api")).rejects.toThrow("forbidden");
  });

  it("asks a signed-out caller to sign in rather than forbidding them", async () => {
    getSession.mockResolvedValue(null);

    await expect(requireAdmin()).rejects.toThrow("redirect:/sign-in");
    await expect(requireAdmin("api")).rejects.toThrow("unauthorized");
  });
});

describe("authHeaders", () => {
  beforeEach(() => {
    jar = new RequestCookies(requestHeaders);
  });

  it("passes the request's cookies through when rendering a page", async () => {
    const authRequest = await authHeaders();

    expect(authRequest.get("cookie")).toBe(`${sessionCookie}=old.sig%2B%3D; theme=dark; stale=1`);
    expect(authRequest.get("user-agent")).toBe("test");
  });

  it("in a server action, sends cookies set or deleted earlier in the action as a Cookie header", async () => {
    const actionJar = MutableRequestCookiesAdapter.wrap(new RequestCookies(requestHeaders));
    // What Better Auth does when changing the password: a new session cookie with attributes.
    actionJar.set(sessionCookie, "new.sig+=", {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 2_592_000,
    });
    actionJar.delete("stale");
    jar = actionJar;

    const authRequest = await authHeaders();

    expect(authRequest.get("cookie")).toBe(`${sessionCookie}=new.sig%2B%3D; theme=dark`);
  });

  it("is what requireUser reads the session from", async () => {
    getSession.mockReset().mockResolvedValue(sessionFor({ role: "user" }));
    const actionJar = MutableRequestCookiesAdapter.wrap(new RequestCookies(requestHeaders));
    actionJar.set(sessionCookie, "new.sig+=", { path: "/", httpOnly: true });
    jar = actionJar;

    await requireUser();

    expect(getSession.mock.calls[0]![0].headers.get("cookie")).toContain(
      `${sessionCookie}=new.sig%2B%3D`,
    );
  });
});
