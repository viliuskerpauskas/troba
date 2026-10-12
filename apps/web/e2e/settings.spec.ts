import { randomBytes } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";

// Each test gets its own user, so password changes and revoked sessions can't affect other tests.
async function createUser(email: string) {
  await db().$client.query("delete from users where email = $1", [email]);
  const password = randomBytes(18).toString("base64");
  await auth().api.createUser({ body: { email, password, name: "Settings Tester" } });
  return { email, password };
}

test.afterAll(async () => {
  await db().$client.end();
});

// A separate browser context is a separate device with its own cookies.
async function signedInDevice(browser: Browser, user: { email: string; password: string }) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/money");
  return page;
}

async function expectSignedOut(page: Page) {
  await page.goto("/settings");
  await expect(page).toHaveURL("/sign-in");
}

test("revoking a session from settings signs that browser out", async ({ browser }) => {
  const user = await createUser("e2e-revoke@example.test");
  const phone = await signedInDevice(browser, user);
  const laptop = await signedInDevice(browser, user);

  await laptop.getByRole("link", { name: "Settings" }).click();
  const sessions = laptop.getByRole("region", { name: "Sessions" }).getByRole("listitem");
  await expect(sessions).toHaveCount(2);
  await expect(sessions.filter({ hasText: "(this device)" })).toHaveCount(1);
  await sessions.getByRole("button", { name: "Sign out Chrome on Windows" }).click();

  await expect(sessions).toHaveCount(1);
  await expectSignedOut(phone);
  await laptop.reload();
  await expect(laptop).toHaveURL("/settings");
});

test("changing the password keeps this browser signed in and signs out the others", async ({
  browser,
}) => {
  const user = await createUser("e2e-password@example.test");
  const phone = await signedInDevice(browser, user);
  const laptop = await signedInDevice(browser, user);
  const newPassword = randomBytes(18).toString("base64");

  await laptop.goto("/settings");
  await laptop.getByLabel("Current password").fill("not the right password");
  await laptop.getByLabel("New password", { exact: true }).fill(newPassword);
  await laptop.getByLabel("Confirm new password").fill(newPassword);
  await laptop.getByRole("button", { name: "Change password" }).click();
  await expect(laptop.getByRole("main").getByRole("alert")).toHaveText(
    "The current password is incorrect.",
  );

  await laptop.getByLabel("Current password").fill(user.password);
  await laptop.getByLabel("New password", { exact: true }).fill(newPassword);
  await laptop.getByLabel("Confirm new password").fill(newPassword);
  await laptop.getByRole("button", { name: "Change password" }).click();
  await expect(laptop.getByRole("main").getByRole("status")).toHaveText(
    "Password changed. Your other devices are signed out.",
  );

  await laptop.reload();
  await expect(laptop).toHaveURL("/settings");
  await expectSignedOut(phone);
  await signedInDevice(browser, { email: user.email, password: newPassword });
});

test("changing the name shows the new name", async ({ browser }) => {
  const user = await createUser("e2e-name@example.test");
  const laptop = await signedInDevice(browser, user);

  await laptop.goto("/settings");
  await laptop.getByLabel("Name").fill("Renamed Tester");
  await laptop.getByRole("button", { name: "Save name" }).click();
  await expect(laptop.getByRole("main").getByRole("status")).toHaveText("Name saved.");

  await laptop.reload();
  await expect(laptop.getByLabel("Name")).toHaveValue("Renamed Tester");
});

test("sign out everywhere ends every session", async ({ browser }) => {
  const user = await createUser("e2e-everywhere@example.test");
  const phone = await signedInDevice(browser, user);
  const laptop = await signedInDevice(browser, user);

  await laptop.goto("/settings");
  await laptop.getByRole("button", { name: "Sign out everywhere" }).click();

  await expect(laptop).toHaveURL("/sign-in");
  await expectSignedOut(laptop);
  await expectSignedOut(phone);
});
