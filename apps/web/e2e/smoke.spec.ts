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
