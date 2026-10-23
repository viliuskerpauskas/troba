import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { adminEmail } from "./global-setup";
import { expect, test } from "./test";

const genericError = "Email or password is incorrect.";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an unauthenticated visit to /money redirects to /sign-in", async ({ page }) => {
  await page.goto("/money");

  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("the sign-in page can't be framed by another site", async ({ request }) => {
  const response = await request.get("/sign-in");

  expect(response.headers()).toMatchObject({
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  });
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("the admin signs in and out", async ({ page, context }) => {
  await signIn(page, adminEmail, process.env.E2E_ADMIN_PASSWORD!);

  await expect(page).toHaveURL("/money");
  await expect(page.getByRole("heading", { level: 1, name: "Money" })).toBeVisible();

  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name.endsWith("session_token"));
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" });
  const days = (session!.expires * 1000 - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(29.9);
  expect(days).toBeLessThanOrEqual(30);

  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL("/sign-in");
  await page.goto("/money");
  await expect(page).toHaveURL("/sign-in");
});

test("a wrong password and an unknown email get the same generic error", async ({ page }) => {
  await signIn(page, adminEmail, "not the right password");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(genericError);

  await signIn(page, "nobody@example.test", "not the right password");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(genericError);
  await expect(page).toHaveURL("/sign-in");
});

test("the 6th failed sign-in in 15 minutes is refused, even with the right password", async ({
  page,
}) => {
  // Its own user and client address, so the lockout can't affect other tests: without a proxy,
  // the app sees every test's requests as coming from the loopback address. 192.0.2.0/24 is TEST-NET-1.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "192.0.2.11" });
  const email = "e2e-locked-out@example.test";
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "Locked Out" } });

  for (let i = 0; i < 5; i++) {
    await signIn(page, email, "not the right password");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(genericError);
  }
  await signIn(page, email, password);

  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Too many failed sign-ins. Wait 15 minutes and try again.",
  );
  await expect(page).toHaveURL("/sign-in");
});
