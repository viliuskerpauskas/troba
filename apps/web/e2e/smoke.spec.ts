import { expect, test } from "@playwright/test";

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

test("health endpoint reports ok with a reachable database", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok", db: "ok" });
});
