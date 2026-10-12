import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
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

const { requireAdmin, requireUser } = await import("./session");

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
