import { expect, test, type Page } from "@playwright/test";
import { adminEmail } from "./global-setup";

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
