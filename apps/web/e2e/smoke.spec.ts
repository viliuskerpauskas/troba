import { expect, test } from "@playwright/test";

// What the server reports as its version: see gitSha() in src/server/env.ts.
const version = process.env.GIT_SHA || "dev";

test("home page renders without console errors", async ({ page }) => {
  // Catches a broken standalone bundle, such as static chunks missing next to server.js.
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { level: 1, name: "troba" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("pages only run scripts carrying the request's nonce", async ({ page }) => {
  const nonces: string[] = [];
  for (let i = 0; i < 2; i++) {
    const response = await page.goto("/");
    const policy = response!.headers()["content-security-policy"] ?? "";

    expect(policy).toMatch(
      /^default-src 'self'; script-src 'self' 'nonce-[\w+/=]+' 'strict-dynamic';/,
    );
    expect(policy).not.toContain("unsafe-eval");
    // Next puts the nonce on its own scripts; the home page test above sees none blocked.
    await expect(page.locator("script[nonce]").first()).toBeAttached();
    nonces.push(policy.match(/'nonce-([\w+/=]+)'/)![1]!);
  }

  expect(nonces[0]).not.toBe(nonces[1]);
});

test("responses the proxy skips still get a policy, with no inline scripts", async ({
  request,
}) => {
  const response = await request.get("/api/health");

  expect(response.headers()["content-security-policy"]).toMatch(
    /^default-src 'self'; script-src 'self'; /,
  );
});

test("HSTS is sent on HTTPS responses only", async ({ request }) => {
  // Caddy terminates TLS and tells the app with X-Forwarded-Proto.
  const https = await request.get("/", { headers: { "x-forwarded-proto": "https" } });
  const http = await request.get("/");

  expect(https.headers()["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  expect(http.headers()["strict-transport-security"]).toBeUndefined();
});

test("page footer shows the running version", async ({ page }) => {
  await page.goto("/");

  // CI builds without GIT_SHA, as the image does, so this fails if the footer is prerendered.
  await expect(page.getByRole("contentinfo")).toHaveText(`Version ${version}`);
});

test("health endpoint reports ok with a reachable database", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  // The deploy polls for this version, so check GIT_SHA reaches the built server.
  expect(await response.json()).toEqual({
    status: "ok",
    version,
    db: "ok",
  });
});
